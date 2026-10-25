import { useEffect, useState, useSyncExternalStore } from "react";
import type { PartialStoryAudio, StoryAudioBrief } from "@mdb/shared";
import { paragraphAt, prepareStoryAudio, type AudioProgress } from "@mdb/client";
import { api } from "./api";

/**
 * Listening to a story like an audiobook (as the app's lib/listening): the
 * server makes one file per story in the reading voice (when asked: "Generate
 * audiobook", or Listen), an <audio> element plays it (on with the tab in the
 * background), and the system's media controls show it with the cover, the
 * book and the chapter. At the end of a chapter it goes on to the next one.
 * Where each story was left, the speed, the skip lengths and the sleep timer
 * are this browser's.
 */

export type SavedPosition = { t: number; duration: number; done: boolean };
export type ListeningState = {
  storyId: string | null;
  title: string;
  /** The book it's a chapter of, and which chapter. */
  book: string | null;
  chapter: { n: number; total: number; prev: string | null; next: string | null } | null;
  phase: "idle" | "preparing" | "playing" | "paused" | "error";
  progress: AudioProgress | null;
  paragraph: number;
  /** Where it is and how long it is, in seconds. */
  position: number;
  duration: number;
  error: string | null;
  /** Playback speed, and how far the skip buttons jump (seconds). */
  rate: number;
  skipBack: number;
  skipForward: number;
  /** The sleep timer: pause at a time (ms), or at the end of the chapter. */
  sleep: { until: number } | { chapterEnd: true } | null;
  /** Where each story was left (and whether it was heard to the end). */
  positions: Record<string, SavedPosition>;
  /** The cover shown with it (a PNG URL). */
  art: string | null;
  /** The player panel is open. */
  open: boolean;
  /** Playing only the paragraphs made so far (the rest waits for the voice's limit). */
  partial: { paragraphs: number; of: number } | null;
  /** The reading voice is a server voice. */
  enabled: boolean;
};
export type StoryRef = { id: string; title: string; book?: string | null };

/** Choices for the skip buttons (a long press picks one). */
export const SKIP_CHOICES = [5, 10, 15, 30, 45, 60] as const;
export const RATE_CHOICES = [0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.5] as const;
const PREFS = "mdb-listening";
const POSITIONS = "mdb-listen-positions";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const prefs = load(PREFS, { rate: 1, skipBack: 15, skipForward: 30 });
let state: ListeningState = {
  storyId: null,
  title: "",
  book: null,
  chapter: null,
  phase: "idle",
  progress: null,
  paragraph: 0,
  position: 0,
  duration: 0,
  error: null,
  rate: prefs.rate,
  skipBack: prefs.skipBack,
  skipForward: prefs.skipForward,
  sleep: null,
  positions: load<Record<string, SavedPosition>>(POSITIONS, {}),
  art: null,
  open: false,
  partial: null,
  enabled: false,
};
const listeners = new Set<() => void>();
function set(next: Partial<ListeningState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}
const savePrefs = () => save(PREFS, { rate: state.rate, skipBack: state.skipBack, skipForward: state.skipForward });

let audio: HTMLAudioElement | null = null;
let current: { id: string; title: string; book: string | null; starts: number[]; duration: number; partial: { paragraphs: number; of: number } | null } | null = null;
let run = 0; // the latest listen(); an older one gives up
let sleepTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved = 0;

/** Remember where the story playing is (now, or at most every few seconds). */
function keepPosition(force = false, done = false) {
  if (!current || !audio) return;
  if (!force && Date.now() - lastSaved < 5000) return;
  lastSaved = Date.now();
  const duration = current.duration || audio.duration || 0;
  const t = audio.currentTime;
  // The end of the paragraphs made so far isn't the end of the story.
  const end = !current.partial && (done || (duration > 0 && t >= duration - 2));
  const positions = { ...state.positions, [current.id]: { t, duration, done: end } };
  set({ positions });
  save(POSITIONS, positions);
}

/** Tell the system's media controls where it is (for their scrubber). */
function positionState() {
  const ms = navigator.mediaSession;
  if (!ms?.setPositionState || !audio || !current) return;
  const duration = current.duration || audio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    ms.setPositionState({ duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, duration) });
  } catch {}
}

function player(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  audio.addEventListener("timeupdate", () => {
    if (!current || !audio) return;
    set({ paragraph: paragraphAt(current.starts, audio.currentTime), position: audio.currentTime });
    keepPosition();
  });
  audio.addEventListener("durationchange", () => {
    if (current && audio && !current.duration && Number.isFinite(audio.duration)) set({ duration: audio.duration });
  });
  audio.addEventListener("play", () => current && set({ phase: "playing" }));
  audio.addEventListener("pause", () => {
    if (!current || audio!.ended) return;
    set({ phase: "paused" });
    keepPosition(true);
  });
  audio.addEventListener("seeked", positionState);
  audio.addEventListener("ratechange", positionState);
  audio.addEventListener("ended", () => void finished());
  const ms = navigator.mediaSession;
  if (ms) {
    const handle = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {} // a browser that doesn't know the action
    };
    handle("play", () => resume());
    handle("pause", () => pause());
    handle("seekbackward", (d) => seekBy(-(d.seekOffset ?? state.skipBack)));
    handle("seekforward", (d) => seekBy(d.seekOffset ?? state.skipForward));
    handle("seekto", (d) => d.seekTime !== undefined && seekTo(d.seekTime));
    handle("stop", () => stop());
  }
  return audio;
}

/** The chapter buttons in the media controls, only when there's a chapter that way. */
function chapterActions() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  try {
    ms.setActionHandler("previoustrack", state.chapter?.prev ? () => void chapter("prev") : null);
    ms.setActionHandler("nexttrack", state.chapter?.next ? () => void chapter("next") : null);
  } catch {}
}

/** The book, the chapter and the cover for what's playing (in the player and the media controls). */
async function describe(story: StoryRef, mine: number) {
  let book = story.book ?? null;
  let chapter: ListeningState["chapter"] = null;
  let art = api.coverPngUrl("story", story.id, `g-${story.title}`, 512);
  try {
    const view = await api.story(story.id);
    art = api.coverPngUrl("story", story.id, `g-${view.story.title}`, 512);
    if (view.series) {
      book = view.series.title;
      chapter = { n: view.series.chapter, total: view.series.total, prev: view.series.prev, next: view.series.next };
      art = api.coverPngUrl("series", view.series.id, `g-${view.series.title}`, 512);
    }
  } catch {}
  if (mine !== run) return;
  set({ book, chapter, art });
  chapterActions();
  if (navigator.mediaSession && "MediaMetadata" in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: story.title,
      artist: book ?? "Wortschritt",
      album: chapter ? `Chapter ${chapter.n} of ${chapter.total}` : "",
      artwork: [{ src: art, sizes: "512x768", type: "image/png" }],
    });
  }
}

/** At the end of a chapter, the next one (unless the sleep timer says stop); else done. */
async function finished() {
  if (current?.partial) return morePartial();
  keepPosition(true, true);
  const next = state.chapter?.next;
  if (state.sleep && "chapterEnd" in state.sleep) return setSleep(null);
  if (next) await playStory(next, 0);
  else set({ phase: "paused" });
}

async function playStory(id: string, from?: number) {
  try {
    const view = await api.story(id);
    await listen({ id, title: view.story.title, book: view.series?.title ?? null }, from);
  } catch (e) {
    set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * The paragraphs made so far ran out: the whole story if it's ready now
 * (from the next paragraph), else any made since, else wait for the rest.
 */
async function morePartial() {
  const was = current!;
  const story = { id: was.id, title: was.title, book: was.book };
  const next = was.partial!.paragraphs;
  try {
    if ((await api.storyAudio(was.id)).state !== "ready") {
      const more = await api.partialStoryAudio(was.id).catch(() => null);
      if (more && more.paragraphs > next) return void playPartial(story, more, more.starts[next] ?? 0);
    }
  } catch {}
  await listen(story, next); // ready: plays on; else shows the wait and plays on when it's made
}

/** Start the paragraphs made so far (from `at` seconds). */
async function playPartial(story: StoryRef, p: PartialStoryAudio, at: number) {
  const mine = ++run;
  const a = player();
  current = { id: story.id, title: story.title, book: story.book ?? null, starts: p.starts, duration: p.duration, partial: { paragraphs: p.paragraphs, of: p.of } };
  a.src = api.storyAudioUrl(story.id, p.key);
  a.playbackRate = state.rate;
  a.currentTime = at;
  try {
    await a.play();
    if (mine !== run) return;
    set({ phase: "playing", progress: null, partial: current.partial, paragraph: paragraphAt(p.starts, at), position: at, duration: p.duration, error: null });
    positionState();
  } catch (e) {
    if (mine === run) set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * While the story's audio waits for the voice's limit: listen to the
 * paragraphs made so far (from where it was left, if that's in them). At
 * their end it goes on by itself once the rest is made.
 */
export async function listenPartial() {
  if (!state.storyId) return;
  const story = { id: state.storyId, title: state.title, book: state.book };
  try {
    const p = await api.partialStoryAudio(story.id);
    const saved = state.positions[story.id];
    void playPartial(story, p, saved && !saved.done && saved.t < p.duration - 3 ? saved.t : 0);
  } catch (e) {
    window.alert(`Nothing to listen to yet: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Listen to a story: from paragraph `from`, or (none given) where it was
 * left, else from the start. The server makes its audio first if needed.
 */
export async function listen(story: StoryRef, from?: number) {
  const mine = ++run;
  keepPosition(true);
  const a = player();
  a.pause();
  const same = state.storyId === story.id;
  set({ storyId: story.id, title: story.title, book: story.book ?? null, ...(same ? {} : { chapter: null, art: null }), phase: "preparing", progress: null, partial: null, paragraph: from ?? 0, position: 0, duration: 0, error: null });
  void describe(story, mine);
  try {
    const ready = await prepareStoryAudio(api, story.id, {
      onProgress: (p) => mine === run && set({ progress: p }),
      isCancelled: () => mine !== run,
    });
    if (mine !== run) return;
    current = { id: story.id, title: story.title, book: story.book ?? null, starts: ready.starts, duration: ready.duration, partial: null };
    a.src = api.storyAudioUrl(story.id, ready.key);
    a.playbackRate = state.rate;
    const saved = state.positions[story.id];
    const start = from !== undefined ? (ready.starts[from] ?? 0) : saved && !saved.done && saved.t < ready.duration - 3 ? saved.t : 0;
    a.currentTime = start;
    await a.play();
    set({ phase: "playing", progress: null, paragraph: paragraphAt(ready.starts, start), position: start, duration: ready.duration });
    positionState();
  } catch (e) {
    if (mine !== run) return;
    set({ phase: "error", progress: null, error: e instanceof Error ? e.message : String(e) });
  }
}

export function stop() {
  keepPosition(true);
  run++;
  current = null;
  setSleep(null);
  audio?.pause();
  if (navigator.mediaSession) navigator.mediaSession.metadata = null;
  set({ storyId: null, title: "", book: null, chapter: null, art: null, phase: "idle", progress: null, partial: null, error: null, paragraph: 0, position: 0, duration: 0, open: false });
}

export const pause = () => audio?.pause();
export const resume = () => void audio?.play().catch(() => {});

export function seekTo(t: number) {
  if (!current || !audio) return;
  const to = Math.max(0, Math.min(t, (current.duration || audio.duration) - 0.5));
  audio.currentTime = to;
  set({ position: to, paragraph: paragraphAt(current.starts, to) });
  keepPosition(true);
}

/** Back (negative) or forward by some seconds. */
export const seekBy = (seconds: number) => audio && seekTo(audio.currentTime + seconds);

export function seekParagraph(i: number) {
  if (!current || !audio) return;
  const t = current.starts[Math.min(i, current.starts.length - 1)];
  if (t === undefined) return;
  audio.currentTime = t;
  set({ paragraph: i });
}

/** The previous or next chapter of the book. */
export async function chapter(dir: "prev" | "next") {
  const id = dir === "prev" ? state.chapter?.prev : state.chapter?.next;
  if (id) await playStory(id, 0);
}

function setSleep(sleep: ListeningState["sleep"]) {
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = null;
  if (sleep && "until" in sleep) {
    sleepTimer = setTimeout(() => {
      audio?.pause();
      set({ sleep: null });
    }, Math.max(0, sleep.until - Date.now()));
  }
  set({ sleep });
}

/** Pause after some minutes, at the end of the chapter, or not (null). */
export function sleepIn(minutes: number | "chapter" | null) {
  setSleep(minutes === null ? null : minutes === "chapter" ? { chapterEnd: true } : { until: Date.now() + minutes * 60_000 });
}

export function setListeningRate(r: number) {
  if (r === state.rate) return;
  if (audio) audio.playbackRate = r;
  set({ rate: r });
  savePrefs();
}

/** How far the skip buttons jump, in seconds. */
export function setSkip(which: "back" | "forward", seconds: number) {
  set(which === "back" ? { skipBack: seconds } : { skipForward: seconds });
  savePrefs();
}

/** Open or close the player panel. */
export const openPlayer = (open = true) => set({ open });

export function setListeningEnabled(on: boolean) {
  if (on !== state.enabled) set({ enabled: on });
}

export function useListening(): ListeningState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => state,
  );
}

/**
 * Every story's audio in short (for the cards and a book's chapters), kept
 * fresh: checked again every 20 seconds while one is being made or waits.
 * `refresh` after asking for some ("Generate audiobook").
 */
export function useStoryAudio(): { audio: Record<string, StoryAudioBrief>; refresh: () => void } {
  const [briefs, setBriefs] = useState<Record<string, StoryAudioBrief>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fetchAll = () =>
      api
        .allStoryAudio()
        .then((a) => {
          if (!live) return;
          setBriefs(a);
          if (Object.values(a).some((s) => s.state === "building" || s.state === "waiting")) timer = setTimeout(fetchAll, 20_000);
        })
        .catch(() => {});
    void fetchAll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tick]);
  return { audio: briefs, refresh: () => setTick((t) => t + 1) };
}

/** "6:48", "1:02:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
