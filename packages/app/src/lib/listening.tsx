import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Platform } from "react-native";
import { createAudioPlayer, requestNotificationPermissionsAsync, setAudioModeAsync, type AudioPlayer, type AudioStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import type { PartialStoryAudio, StoryAudioBrief } from "@mdb/shared";
import { isNetworkError, listeningProgress, paragraphAt, prepareStoryAudio, type Api, type AudioProgress } from "@mdb/client";
import { deviceStore } from "./storage";

/**
 * Listening to a story like an audiobook: the server makes one file per story
 * in the reading voice (when asked: "Generate audiobook", or Listen), the app
 * downloads it and plays it with the system's media controls, so it carries
 * on with the screen off or in another app. At the end of a chapter it goes
 * on to the next one. Downloaded files stay ("Download for listening"), so a
 * story plays offline too. One player for the whole app: the player sheet,
 * the mini-player and the reader (which highlights along) all follow it.
 * Where each story was left, the speed, the skip lengths and the sleep timer
 * are this device's.
 */

export type ListeningPhase = "idle" | "preparing" | "playing" | "paused" | "error";
export type SavedPosition = { t: number; duration: number; done: boolean };
export type ListeningState = {
  storyId: string | null;
  title: string;
  /** The book it's a chapter of, and which chapter. */
  book: string | null;
  chapter: { n: number; total: number; prev: string | null; next: string | null } | null;
  phase: ListeningPhase;
  /** While the server makes the audio: clips made, of how many (and when it tries again, if waiting). */
  progress: AudioProgress | null;
  /** The paragraph being read (storyParagraphs index). */
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
  /** The cover shown with it (a server URL), for the player and the mini-player. */
  art: string | null;
  /** Story ids downloaded for listening. */
  downloaded: string[];
  /** Story ids being downloaded right now (without playing). */
  downloading: string[];
  /** The reading voice is a server voice, so stories can be listened to (downloads play regardless). */
  enabled: boolean;
  /** Playing only the paragraphs made so far (the rest waits for the voice's limit). */
  partial: { paragraphs: number; of: number } | null;
};

type Entry = { key: string; starts: number[]; duration: number; title: string };
export type StoryRef = { id: string; title: string; book?: string | null };

const native = Platform.OS !== "web";
const dir = native ? new Directory(Paths.document, "story-audio") : null;
const indexFile = dir ? new File(dir, "index.json") : null;
const artDir = native ? new Directory(Paths.cache, "listen-art") : null;
/** The paragraphs made so far, while the rest waits (not kept as downloads). */
const partialDir = native ? new Directory(Paths.cache, "story-audio-partial") : null;
const PREFS = "mdb-listening";
const POSITIONS = "mdb-listen-positions";
/** Choices for the skip buttons (a long press picks one). */
export const SKIP_CHOICES = [5, 10, 15, 30, 45, 60] as const;
export const RATE_CHOICES = [0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.5] as const;

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
    book: null,
    chapter: null,
    phase: "idle",
    progress: null,
    paragraph: 0,
    position: 0,
    duration: 0,
    error: null,
    rate: 1,
    skipBack: 15,
    skipForward: 30,
    sleep: null,
    positions: {},
    art: null,
    downloaded: Object.keys(index),
    downloading: [],
    enabled: false,
    partial: null,
  };
  const listeners = new Set<() => void>();
  const set = (next: Partial<ListeningState>) => {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };
  let player: AudioPlayer | null = null;
  let current: (Entry & { id: string; book: string | null; partial: ListeningState["partial"] }) | null = null;
  let run = 0; // the latest listen(); an older one gives up
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSaved = 0;

  // This device's choices and where each story was left.
  void (async () => {
    try {
      const prefs = JSON.parse((await deviceStore.get(PREFS)) ?? "{}") as Partial<Pick<ListeningState, "rate" | "skipBack" | "skipForward">>;
      const positions = JSON.parse((await deviceStore.get(POSITIONS)) ?? "{}") as Record<string, SavedPosition>;
      set({
        rate: typeof prefs.rate === "number" ? prefs.rate : 1,
        skipBack: typeof prefs.skipBack === "number" ? prefs.skipBack : 15,
        skipForward: typeof prefs.skipForward === "number" ? prefs.skipForward : 30,
        positions,
      });
    } catch {}
  })();
  /** Store something of this device's, not minding if it fails. */
  const store = (key: string, value: unknown) => void Promise.resolve(deviceStore.set(key, JSON.stringify(value))).catch(() => {});
  const savePrefs = () => store(PREFS, { rate: state.rate, skipBack: state.skipBack, skipForward: state.skipForward });

  /** Listening counts as reading (the story's progress follows the paragraphs heard). */
  const heard = listeningProgress(api);
  const storyHeard = () => ({ id: current!.id, starts: current!.starts, duration: current!.duration, partial: Boolean(current!.partial) });

  /** Remember where the story playing is (now, or at most every few seconds). */
  function keepPosition(force = false, done = false) {
    if (!current || !player) return;
    if (!force && Date.now() - lastSaved < 5000) return;
    lastSaved = Date.now();
    const duration = current.duration || player.duration || 0;
    const t = player.currentTime;
    // The end of the paragraphs made so far isn't the end of the story.
    const end = !current.partial && (done || (duration > 0 && t >= duration - 2));
    const positions = { ...state.positions, [current.id]: { t, duration, done: end } };
    set({ positions });
    store(POSITIONS, positions);
  }

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

  /** The cover as a local file for the media notification (it can't send our sign-in), if it downloads. */
  async function artFile(url: string): Promise<string | undefined> {
    if (!artDir) return undefined;
    try {
      if (!artDir.exists) artDir.create({ intermediates: true, idempotent: true });
      const name = url.replace(/[^a-z0-9]+/gi, "_").slice(-120);
      const file = new File(artDir, `${name}.png`);
      if (!file.exists) await File.downloadFileAsync(url, file, { headers: headers(), idempotent: true });
      return file.uri;
    } catch {
      return undefined;
    }
  }

  /** The book, the chapter and the cover for what's playing (in the player and the notification). */
  async function describe(story: StoryRef, mine: number) {
    let book = story.book ?? null;
    let chapter: ListeningState["chapter"] = null;
    let art = api.coverPngUrl("story", story.id, `g-${story.title}`, 512);
    try {
      const view = await api.story(story.id);
      if (view.series) {
        book = view.series.title;
        chapter = { n: view.series.chapter, total: view.series.total, prev: view.series.prev, next: view.series.next };
        art = api.coverPngUrl("series", view.series.id, `g-${view.series.title}`, 512);
      }
    } catch {}
    if (mine !== run) return;
    set({ book, chapter, art });
    const artworkUrl = await artFile(art);
    if (mine !== run || !player) return;
    player.updateLockScreenMetadata({
      title: story.title,
      artist: book ?? "Wortschritt",
      ...(chapter ? { albumTitle: `Chapter ${chapter.n} of ${chapter.total}` } : {}),
      ...(artworkUrl ? { artworkUrl } : {}),
    });
  }

  function onStatus(s: AudioStatus) {
    if (!current) return;
    const paragraph = paragraphAt(current.starts, s.currentTime);
    const phase = state.phase === "playing" || state.phase === "paused" ? (s.playing ? "playing" : "paused") : state.phase;
    set({ paragraph, phase, position: s.currentTime, duration: current.duration || s.duration || state.duration });
    keepPosition(!s.playing);
    if (s.playing) heard(storyHeard(), s.currentTime);
    if (s.didJustFinish) void finished();
  }

  /** At the end of a chapter, the next one (unless the sleep timer says stop); else done. */
  async function finished() {
    if (current?.partial) return morePartial();
    keepPosition(true, true);
    if (current) heard(storyHeard(), 0, true);
    const next = state.chapter?.next;
    if (state.sleep && "chapterEnd" in state.sleep) {
      setSleep(null);
      return;
    }
    if (next) await playStory(next);
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

  async function ensurePlayer(): Promise<AudioPlayer> {
    if (player) return player;
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" });
    // The media notification (the controls that keep it playing in the background) needs this on Android 13+.
    if (Platform.OS === "android") await requestNotificationPermissionsAsync().catch(() => undefined);
    player = createAudioPlayer(null, { updateInterval: 500 });
    player.addListener("playbackStatusUpdate", onStatus);
    return player;
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
  async function playPartial(story: StoryRef, part: PartialStoryAudio, at: number) {
    const mine = ++run;
    try {
      if (!partialDir) throw new Error("Listening needs the app.");
      if (!partialDir.exists) partialDir.create({ intermediates: true, idempotent: true });
      const file = new File(partialDir, `${part.key}.mp3`);
      if (!file.exists || !file.size) await File.downloadFileAsync(api.storyAudioUrl(story.id, part.key), file, { headers: headers(), idempotent: true });
      if (mine !== run) return;
      const p = await ensurePlayer();
      current = { key: part.key, starts: part.starts, duration: part.duration, title: story.title, id: story.id, book: story.book ?? null, partial: { paragraphs: part.paragraphs, of: part.of } };
      p.replace({ uri: file.uri });
      p.setPlaybackRate(state.rate);
      p.setActiveForLockScreen(true, { title: story.title, artist: state.book ?? story.book ?? "Wortschritt" }, { showSeekBackward: true, showSeekForward: true });
      await p.seekTo(at);
      p.play();
      set({ phase: "playing", progress: null, partial: current.partial, paragraph: paragraphAt(part.starts, at), position: at, duration: part.duration, error: null });
      void describe(story, mine);
    } catch (e) {
      if (mine === run) set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * While the story's audio waits for the voice's limit: listen to the
   * paragraphs made so far (from where it was left, if that's in them). At
   * their end it goes on by itself once the rest is made.
   */
  async function listenPartial() {
    if (!state.storyId) return;
    const story = { id: state.storyId, title: state.title, book: state.book };
    const part = await api.partialStoryAudio(story.id);
    const saved = state.positions[story.id];
    await playPartial(story, part, saved && !saved.done && saved.t < part.duration - 3 ? saved.t : 0);
  }

  /**
   * Listen to a story: from paragraph `from`, or (none given) where it was
   * left, else from the start. Its audio is made and downloaded first if needed.
   */
  async function listen(story: StoryRef, from?: number) {
    const mine = ++run;
    keepPosition(true);
    player?.pause();
    const same = state.storyId === story.id;
    set({ storyId: story.id, title: story.title, book: story.book ?? null, ...(same ? {} : { chapter: null, art: null }), phase: "preparing", progress: null, partial: null, paragraph: from ?? 0, position: 0, duration: 0, error: null });
    void describe(story, mine);
    try {
      const entry = await fetchAudio(story, (p) => mine === run && set({ progress: p }), () => mine !== run);
      if (mine !== run) return;
      const p = await ensurePlayer();
      current = { ...entry, id: story.id, book: story.book ?? null, partial: null };
      p.replace({ uri: new File(dir!, `${entry.key}.mp3`).uri });
      p.setPlaybackRate(state.rate);
      p.setActiveForLockScreen(true, { title: story.title, artist: state.book ?? story.book ?? "Wortschritt" }, { showSeekBackward: true, showSeekForward: true });
      const saved = state.positions[story.id];
      const start = from !== undefined ? (entry.starts[from] ?? 0) : saved && !saved.done && saved.t < entry.duration - 3 ? saved.t : 0;
      await p.seekTo(start);
      p.play();
      set({ phase: "playing", progress: null, paragraph: paragraphAt(entry.starts, start), position: start, duration: entry.duration });
      void describe(story, mine); // again, now that the notification is up
    } catch (e) {
      if (mine !== run) return;
      set({ phase: "error", progress: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  function stop() {
    keepPosition(true);
    run++;
    current = null;
    setSleep(null);
    if (player) {
      player.pause();
      player.setActiveForLockScreen(false);
    }
    set({ storyId: null, title: "", book: null, chapter: null, art: null, phase: "idle", progress: null, partial: null, error: null, paragraph: 0, position: 0, duration: 0 });
  }

  function seekTo(t: number) {
    if (!player || !current) return;
    const to = Math.max(0, Math.min(t, (current.duration || player.duration) - 0.5));
    void player.seekTo(to);
    set({ position: to, paragraph: paragraphAt(current.starts, to) });
    keepPosition(true);
  }

  function setSleep(sleep: ListeningState["sleep"]) {
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = null;
    if (sleep && "until" in sleep) {
      sleepTimer = setTimeout(() => {
        player?.pause();
        keepPosition(true);
        set({ sleep: null });
      }, Math.max(0, sleep.until - Date.now()));
    }
    if (sleep === null && state.sleep && "chapterEnd" in state.sleep) player?.pause();
    set({ sleep });
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
    setRate(rate: number) {
      if (rate === state.rate) return;
      player?.setPlaybackRate(rate);
      set({ rate });
      savePrefs();
    },
    /** How far the skip buttons jump, in seconds. */
    setSkip(which: "back" | "forward", seconds: number) {
      set(which === "back" ? { skipBack: seconds } : { skipForward: seconds });
      savePrefs();
    },
    listen,
    listenPartial,
    stop,
    pause() {
      player?.pause();
      keepPosition(true);
    },
    resume: () => player?.play(),
    seekTo,
    /** Back (negative) or forward by some seconds. */
    seekBy: (seconds: number) => player && seekTo(player.currentTime + seconds),
    /** The previous or next chapter of the book. */
    async chapter(dir: "prev" | "next") {
      const id = dir === "prev" ? state.chapter?.prev : state.chapter?.next;
      if (id) await playStory(id, 0);
    },
    /** Pause after some minutes, at the end of the chapter, or not (null). */
    sleepIn(minutes: number | "chapter" | null) {
      setSleep(minutes === null ? null : minutes === "chapter" ? { chapterEnd: true } : { until: Date.now() + minutes * 60_000 });
    },
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

const idle: ListeningState = {
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
  rate: 1,
  skipBack: 15,
  skipForward: 30,
  sleep: null,
  positions: {},
  art: null,
  downloaded: [],
  downloading: [],
  enabled: false,
  partial: null,
};

/** The app's listening player and its state (null outside a signed-in session). */
export function useListening(): { controller: ListeningController | null; state: ListeningState } {
  const controller = useContext(Ctx);
  const state = useSyncExternalStore(
    (l) => controller?.subscribe(l) ?? (() => {}),
    () => controller?.get() ?? idle,
  );
  return { controller, state };
}

/**
 * Every story's audio in short (for the cards and a book's chapters), kept
 * fresh: checked again every 20 seconds while one is being made or waits.
 * `refresh` after asking for some ("Generate audiobook").
 */
export function useStoryAudio(api: Api | null): { audio: Record<string, StoryAudioBrief>; refresh: () => void } {
  const [audio, setAudio] = useState<Record<string, StoryAudioBrief>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!api) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api
        .allStoryAudio()
        .then((a) => {
          if (!live) return;
          setAudio(a);
          if (Object.values(a).some((s) => s.state === "building" || s.state === "waiting")) timer = setTimeout(load, 20_000);
        })
        .catch(() => {});
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, tick]);
  return { audio, refresh: () => setTick((t) => t + 1) };
}

/** "6:48", "1:02:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
