import { useSyncExternalStore } from "react";
import { paragraphAt, prepareStoryAudio, type AudioProgress } from "@mdb/client";
import { api } from "./api";

/**
 * Listening to a story like an audiobook (as the app's lib/listening): the
 * server makes one file per story in the reading voice, an <audio> element
 * plays it (on with the tab in the background), the system's media controls
 * show it, and at the end of a chapter it goes on to the next one.
 */

export type ListeningState = {
  storyId: string | null;
  title: string;
  phase: "idle" | "preparing" | "playing" | "paused" | "error";
  progress: AudioProgress | null;
  paragraph: number;
  error: string | null;
  /** The reading voice is a server voice. */
  enabled: boolean;
};
type StoryRef = { id: string; title: string; book?: string | null };

let state: ListeningState = { storyId: null, title: "", phase: "idle", progress: null, paragraph: 0, error: null, enabled: false };
const listeners = new Set<() => void>();
function set(next: Partial<ListeningState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

let audio: HTMLAudioElement | null = null;
let current: { id: string; book: string | null; starts: number[] } | null = null;
let rate = 1;
let run = 0;

function player(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  audio.addEventListener("timeupdate", () => {
    if (!current || !audio) return;
    const paragraph = paragraphAt(current.starts, audio.currentTime);
    if (paragraph !== state.paragraph) set({ paragraph });
  });
  audio.addEventListener("play", () => current && set({ phase: "playing" }));
  audio.addEventListener("pause", () => current && !audio!.ended && set({ phase: "paused" }));
  audio.addEventListener("ended", () => void finished());
  const ms = navigator.mediaSession;
  if (ms) {
    ms.setActionHandler("play", () => void audio?.play());
    ms.setActionHandler("pause", () => audio?.pause());
    ms.setActionHandler("seekbackward", () => audio && (audio.currentTime = Math.max(0, audio.currentTime - 10)));
    ms.setActionHandler("seekforward", () => audio && (audio.currentTime += 10));
    ms.setActionHandler("previoustrack", () => seekParagraph(Math.max(0, state.paragraph - 1)));
    ms.setActionHandler("nexttrack", () => seekParagraph(state.paragraph + 1));
  }
  return audio;
}

/** At the end of a chapter, the next one; else done. */
async function finished() {
  const id = current?.id;
  if (!id) return;
  try {
    const view = await api.story(id);
    if (view.series?.next) {
      const next = await api.story(view.series.next);
      return void listen({ id: next.story.id, title: next.story.title, book: next.series?.title ?? null }, 0);
    }
  } catch {}
  stop();
}

/** Listen to a story from paragraph `from` (the server makes its audio first if needed). */
export async function listen(story: StoryRef, from = 0) {
  const mine = ++run;
  const a = player();
  a.pause();
  set({ storyId: story.id, title: story.title, phase: "preparing", progress: null, paragraph: from, error: null });
  try {
    const ready = await prepareStoryAudio(api, story.id, {
      onProgress: (p) => mine === run && set({ progress: p }),
      isCancelled: () => mine !== run,
    });
    if (mine !== run) return;
    current = { id: story.id, book: story.book ?? null, starts: ready.starts };
    a.src = api.storyAudioUrl(story.id, ready.key);
    a.playbackRate = rate;
    a.currentTime = ready.starts[from] ?? 0;
    if (navigator.mediaSession && "MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: story.title, artist: story.book ?? "Wortschritt" });
    }
    await a.play();
    set({ phase: "playing", progress: null, paragraph: from });
  } catch (e) {
    if (mine !== run) return;
    set({ phase: "error", progress: null, error: e instanceof Error ? e.message : String(e) });
  }
}

export function stop() {
  run++;
  current = null;
  audio?.pause();
  if (navigator.mediaSession) navigator.mediaSession.metadata = null;
  set({ storyId: null, title: "", phase: "idle", progress: null, error: null, paragraph: 0 });
}

export const pause = () => audio?.pause();
export const resume = () => void audio?.play();

export function seekParagraph(i: number) {
  if (!current || !audio) return;
  const t = current.starts[Math.min(i, current.starts.length - 1)];
  if (t === undefined) return;
  audio.currentTime = t;
  set({ paragraph: i });
}

export function setListeningRate(r: number) {
  rate = r;
  if (audio) audio.playbackRate = r;
}

export function setListeningEnabled(on: boolean) {
  if (on !== state.enabled) set({ enabled: on });
}

export function useListening(): ListeningState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => state,
  );
}
