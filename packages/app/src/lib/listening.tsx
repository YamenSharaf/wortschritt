import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { Platform } from "react-native";
import { createAudioPlayer, requestNotificationPermissionsAsync, setAudioModeAsync, type AudioPlayer, type AudioStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import { isNetworkError, paragraphAt, prepareStoryAudio, type Api, type AudioProgress } from "@mdb/client";

/**
 * Listening to a story like an audiobook: the server makes one file per story
 * in the reading voice (on demand), the app downloads it and plays it with
 * the system's media controls, so it carries on with the screen off or in
 * another app. At the end of a chapter it goes on to the next one. Downloaded
 * files stay (that's "Download for listening"), so a story plays offline too.
 * One player for the whole app; the reader follows it to highlight.
 */

export type ListeningPhase = "idle" | "preparing" | "playing" | "paused" | "error";
export type ListeningState = {
  storyId: string | null;
  title: string;
  phase: ListeningPhase;
  /** While the server makes the audio: clips made, of how many. */
  progress: AudioProgress | null;
  /** The paragraph being read (storyParagraphs index). */
  paragraph: number;
  error: string | null;
  /** Story ids downloaded for listening. */
  downloaded: string[];
  /** Story ids being downloaded right now (without playing). */
  downloading: string[];
  /** The reading voice is a server voice, so stories can be listened to (downloads play regardless). */
  enabled: boolean;
};

type Entry = { key: string; starts: number[]; duration: number; title: string };
type StoryRef = { id: string; title: string; book?: string | null };

const native = Platform.OS !== "web";
const dir = native ? new Directory(Paths.document, "story-audio") : null;
const indexFile = dir ? new File(dir, "index.json") : null;

function readIndex(): Record<string, Entry> {
  try {
    return indexFile?.exists ? (JSON.parse(indexFile.textSync()) as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

export function createListening(api: Api, headers: () => Record<string, string>) {
  let index = readIndex();
  let state: ListeningState = {
    storyId: null,
    title: "",
    phase: "idle",
    progress: null,
    paragraph: 0,
    error: null,
    downloaded: Object.keys(index),
    downloading: [],
    enabled: false,
  };
  const listeners = new Set<() => void>();
  const set = (next: Partial<ListeningState>) => {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };
  let rate = 1;
  let player: AudioPlayer | null = null;
  let current: (Entry & { id: string; book: string | null }) | null = null;
  let run = 0; // the latest listen(); an older one gives up

  function saveIndex() {
    try {
      if (dir && !dir.exists) dir.create({ intermediates: true, idempotent: true });
      indexFile?.write(JSON.stringify(index));
    } catch {}
    set({ downloaded: Object.keys(index) });
  }

  /** The story's audio as a local file: made by the server and downloaded if needed; offline, the kept one. */
  async function fetchAudio(story: StoryRef, onProgress?: (p: AudioProgress) => void, isCancelled?: () => boolean): Promise<Entry> {
    const kept = index[story.id];
    let ready;
    try {
      ready = await prepareStoryAudio(api, story.id, { onProgress, isCancelled });
    } catch (e) {
      if (kept && isNetworkError(e) && dir && new File(dir, `${kept.key}.mp3`).exists) return kept;
      throw e;
    }
    if (!dir) throw new Error("Listening needs the app.");
    const file = new File(dir, `${ready.key}.mp3`);
    if (!file.exists || !file.size) {
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const got = await File.downloadFileAsync(api.storyAudioUrl(story.id, ready.key), file, { headers: headers(), idempotent: true });
      if (!got.exists || !got.size) throw new Error("The audio didn't download.");
    }
    // A new version (edited story, another voice) replaces the old file.
    if (kept && kept.key !== ready.key) {
      try {
        new File(dir, `${kept.key}.mp3`).delete();
      } catch {}
    }
    index = { ...index, [story.id]: { key: ready.key, starts: ready.starts, duration: ready.duration, title: story.title } };
    saveIndex();
    return index[story.id]!;
  }

  function onStatus(s: AudioStatus) {
    if (!current) return;
    const paragraph = paragraphAt(current.starts, s.currentTime);
    if (paragraph !== state.paragraph || (s.playing ? "playing" : "paused") !== state.phase) {
      if (state.phase === "playing" || state.phase === "paused") set({ paragraph, phase: s.playing ? "playing" : "paused" });
    }
    if (s.didJustFinish) void finished();
  }

  /** At the end of a chapter, the next one; else done. */
  async function finished() {
    const book = current?.book;
    const id = current?.id;
    if (!id) return;
    let next: { id: string; title: string; book: string | null } | null = null;
    try {
      const view = await api.story(id);
      if (view.series?.next) {
        const nv = await api.story(view.series.next);
        next = { id: nv.story.id, title: nv.story.title, book: nv.series?.title ?? book ?? null };
      }
    } catch {}
    if (next) void listen(next, 0);
    else stop();
  }

  async function ensurePlayer(): Promise<AudioPlayer> {
    if (player) return player;
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" });
    // The media notification (the controls that keep it playing in the background) needs this on Android 13+.
    if (Platform.OS === "android") await requestNotificationPermissionsAsync().catch(() => undefined);
    player = createAudioPlayer(null, { updateInterval: 500 });
    player.addListener("playbackStatusUpdate", onStatus);
    return player;
  }

  /** Listen to a story from paragraph `from` (preparing and downloading its audio first if needed). */
  async function listen(story: StoryRef, from = 0) {
    const mine = ++run;
    player?.pause();
    set({ storyId: story.id, title: story.title, phase: "preparing", progress: null, paragraph: from, error: null });
    try {
      const entry = await fetchAudio(story, (p) => mine === run && set({ progress: p }), () => mine !== run);
      if (mine !== run) return;
      const p = await ensurePlayer();
      current = { ...entry, id: story.id, book: story.book ?? null };
      p.replace({ uri: new File(dir!, `${entry.key}.mp3`).uri });
      p.setPlaybackRate(rate);
      p.setActiveForLockScreen(true, { title: story.title, artist: story.book ?? "Wortschritt" }, { showSeekBackward: true, showSeekForward: true });
      await p.seekTo(entry.starts[from] ?? 0);
      p.play();
      set({ phase: "playing", progress: null, paragraph: from });
    } catch (e) {
      if (mine !== run) return;
      set({ phase: "error", progress: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  function stop() {
    run++;
    current = null;
    if (player) {
      player.pause();
      player.setActiveForLockScreen(false);
    }
    set({ storyId: null, title: "", phase: "idle", progress: null, error: null, paragraph: 0 });
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    get: () => state,
    setEnabled(on: boolean) {
      if (on !== state.enabled) set({ enabled: on });
    },
    setRate(r: number) {
      if (r === rate) return;
      rate = r;
      player?.setPlaybackRate(r);
    },
    listen,
    stop,
    pause: () => player?.pause(),
    resume: () => player?.play(),
    /** Jump to a paragraph of the story playing. */
    seekParagraph(i: number) {
      if (!current || !player) return;
      void player.seekTo(current.starts[i] ?? 0);
      set({ paragraph: i });
    },
    /** Download a story's audio for listening later, without playing it. */
    async download(story: StoryRef) {
      set({ downloading: [...state.downloading, story.id] });
      try {
        await fetchAudio(story);
      } finally {
        set({ downloading: state.downloading.filter((x) => x !== story.id) });
      }
    },
    removeDownload(storyId: string) {
      const kept = index[storyId];
      if (!kept) return;
      if (state.storyId === storyId) stop();
      try {
        if (dir) new File(dir, `${kept.key}.mp3`).delete();
      } catch {}
      const { [storyId]: _, ...rest } = index;
      index = rest;
      saveIndex();
    },
    /** Remove every download (signing out). */
    clear() {
      stop();
      try {
        if (dir?.exists) dir.delete();
      } catch {}
      index = {};
      set({ downloaded: [] });
    },
  };
}

export type ListeningController = ReturnType<typeof createListening>;

/** Remove every downloaded story audio (signing out). */
export function clearStoryAudio() {
  try {
    if (dir?.exists) dir.delete();
  } catch {}
}

const Ctx = createContext<ListeningController | null>(null);

export function ListeningProvider({ api, headers, children }: { api: Api | null; headers: () => Record<string, string>; children: ReactNode }) {
  const controller = useMemo(() => (api ? createListening(api, headers) : null), [api, headers]);
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

const idle: ListeningState = { storyId: null, title: "", phase: "idle", progress: null, paragraph: 0, error: null, downloaded: [], downloading: [], enabled: false };

/** The app's listening player and its state (null outside a signed-in session). */
export function useListening(): { controller: ListeningController | null; state: ListeningState } {
  const controller = useContext(Ctx);
  const state = useSyncExternalStore(
    (l) => controller?.subscribe(l) ?? (() => {}),
    () => controller?.get() ?? idle,
  );
  return { controller, state };
}
