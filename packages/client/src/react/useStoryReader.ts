import { useCallback, useEffect, useRef, useState } from "react";
import {
  readerSettings as readerSettingsSchema,
  storySetId,
  type AnswerVerdict,
  type ExerciseItem,
  type ItemResponse,
  type ReaderSettings,
  type Settings,
  type Story,
  type StoryView,
} from "@mdb/shared";
import { timers, type TimerId } from "../timers";
import { useApi, useSpeech } from "./context";

/*
 * The story reader's state, apart from laying the text out: each platform
 * paginates or scrolls its own way and reports what's on screen to these.
 */

/** A story to read, and marking it read (or unread again). */
export function useStory(id: string) {
  const api = useApi();
  const [view, setView] = useState<StoryView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .story(id)
      .then(setView)
      .catch(() => setError("This story doesn't exist (or isn't yours)."));
  }, [api, id]);

  /** Reflect a read the server recorded (also after finishing the quiz). */
  const showRead = useCallback(
    () => setView((v) => (v ? { ...v, readAt: Math.floor(Date.now() / 1000), progress: 1, status: "read", resumeAt: null } : v)),
    [],
  );

  async function markRead() {
    if (!view) return;
    await api.markStoryRead(view.story.id);
    showRead();
  }

  return {
    view,
    error,
    showRead,
    markRead,
    /** "Read again": unread, back to the start, on the server too. */
    async readAgain() {
      if (!view) return;
      await api.readStoryAgain(view.story.id);
      setView({ ...view, readAt: null, progress: 0, status: "unread", resumeAt: null });
    },
    /** "Next chapter": finishing this one counts as having read it. Resolves with the next chapter's id. */
    async nextChapter(): Promise<string | null> {
      const next = view?.series?.next;
      if (!view || !next) return null;
      if (!view.readAt) await markRead().catch(() => {});
      return next;
    },
  };
}

/** Whether the learner has an AI tutor set up. */
export function useAssistantEnabled(): boolean {
  const api = useApi();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    api.assistantStatus().then((s) => setEnabled(s.enabled)).catch(() => {});
  }, [api]);
  return enabled;
}

/**
 * The reader settings (font, size, theme, …): applied at once, saved to the
 * account shortly after. A change not saved yet is saved on unmount, or by
 * `flush` (the web calls it when the page is closing).
 */
export function useReaderSettings() {
  const api = useApi();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reader, setReader] = useState<ReaderSettings>(() => readerSettingsSchema.parse({}));
  const saveTimer = useRef<TimerId | undefined>(undefined);
  const pending = useRef<Settings | null>(null);

  useEffect(() => {
    api
      .settings()
      .then((se) => {
        setSettings(se);
        setReader(se.reader);
      })
      .catch(() => {});
  }, [api]);

  const flush = useCallback(() => {
    timers.clearTimeout(saveTimer.current);
    const updated = pending.current;
    pending.current = null;
    if (updated) api.saveSettings(updated, { keepalive: true }).catch(() => {});
  }, [api]);
  useEffect(() => flush, [flush]);

  function change(patch: Partial<ReaderSettings>) {
    const next = { ...reader, ...patch };
    setReader(next);
    if (!settings) return;
    const updated = { ...settings, reader: next };
    setSettings(updated);
    pending.current = updated;
    timers.clearTimeout(saveTimer.current);
    saveTimer.current = timers.setTimeout(flush, 600);
  }

  return { reader, change, flush };
}

/**
 * English line by line: the stored translations on open; missing ones are
 * asked for with `request` (the paragraphs on screen), a few at a time, with
 * the learner's AI. In "peek" mode each line stays hidden until revealed.
 */
export function useStoryTranslations({ storyId, enabled }: { storyId?: string; enabled: boolean }) {
  const api = useApi();
  /** English lines per paragraph index (null = not translated yet). */
  const [lines, setLines] = useState<Record<number, string[] | null>>({});
  const [translating, setTranslating] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const queued = useRef(new Set<number>());
  const flushTimer = useRef<TimerId | undefined>(undefined);
  const inFlight = useRef(new Set<number>());
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const keep = (t: { paragraphs: { index: number; lines: string[] | null }[] }) =>
    setLines(Object.fromEntries(t.paragraphs.map((p) => [p.index, p.lines])));

  useEffect(() => {
    if (!storyId) return;
    api.storyTranslations(storyId).then(keep).catch(() => {});
  }, [api, storyId]);
  useEffect(() => () => timers.clearTimeout(flushTimer.current), []);

  const request = useCallback(
    (indices: number[]) => {
      if (!storyId || !enabled || error) return;
      for (const i of indices) {
        if (linesRef.current[i] === null && !inFlight.current.has(i)) queued.current.add(i);
      }
      timers.clearTimeout(flushTimer.current);
      flushTimer.current = timers.setTimeout(() => {
        const batch = [...queued.current].filter((i) => !inFlight.current.has(i)).slice(0, 4);
        queued.current.clear();
        if (!batch.length) return;
        batch.forEach((i) => inFlight.current.add(i));
        setTranslating(new Set(inFlight.current));
        api
          .translateStory(storyId, batch)
          .then(keep)
          .catch((e) => setError(e instanceof Error ? e.message : "Couldn't translate."))
          .finally(() => {
            batch.forEach((i) => inFlight.current.delete(i));
            setTranslating(new Set(inFlight.current));
          });
      }, 250);
    },
    [api, storyId, enabled, error],
  );

  return {
    lines,
    translating,
    error,
    clearError: () => setError(null),
    /** Any paragraph has its English already (shown even without an AI). */
    hasAny: Object.values(lines).some(Boolean),
    request,
    revealed,
    reveal: (key: string) => setRevealed((r) => new Set(r).add(key)),
  };
}

/**
 * How far the learner has read (0–1, only ever further), saved every couple
 * of seconds and on leaving. Starts from the server's position.
 */
export function useReadingProgress(view: StoryView | null) {
  const api = useApi();
  const progress = useRef(0);
  const saved = useRef(0);
  const storyId = view?.story.id;
  const start = view?.progress ?? 0;

  useEffect(() => {
    if (!storyId) return;
    progress.current = saved.current = start;
    const save = () => {
      if (Math.abs(progress.current - saved.current) < 0.02) return;
      saved.current = progress.current;
      api.storyProgress(storyId, Math.round(progress.current * 1000) / 1000).catch(() => {});
    };
    const timer = timers.setInterval(save, 2000);
    return () => {
      timers.clearInterval(timer);
      save();
    };
  }, [api, storyId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    /** The learner has seen up to `fraction` of the story. */
    see(fraction: number) {
      progress.current = Math.max(progress.current, Math.min(1, Math.max(0, fraction)));
    },
    /** Back to the start (after "Read again", which the server records itself). */
    reset() {
      progress.current = saved.current = 0;
    },
  };
}

/** A word as the reader finds it in a story's text. */
export const storyWordRe = /[\p{L}ß]+(?:-[\p{L}ß]+)*/gu;

/** Base forms of a story's words, so "ging" counts as saved when "gehen" is. */
export function useStoryLemmas(body: string | undefined): Record<string, string> {
  const api = useApi();
  const [lemmas, setLemmas] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!body) return;
    const unique = [...new Set(body.match(storyWordRe) ?? [])].slice(0, 3000);
    api.lemmas(unique).then(setLemmas).catch(() => {});
  }, [api, body]);
  return lemmas;
}

/** Whether `word` (or its base form) is in the learner's saved words (lower-cased). */
export function isSavedWord(word: string, saved: Set<string>, lemmas: Record<string, string>): boolean {
  const lemma = lemmas[word];
  return saved.has(word.toLowerCase()) || (!!lemma && saved.has(lemma.toLowerCase()));
}

/** Reading a story's paragraphs aloud; `speaking` is the one being read. */
export function useReadAloud() {
  const speech = useSpeech();
  const [speaking, setSpeaking] = useState<number | null>(null);
  useEffect(() => () => speech.stop(), [speech]);
  return {
    supported: speech.supported(),
    speaking,
    /** Read `paragraphs` from index `from` on; `onParagraph` lets the reader follow along. */
    read(paragraphs: string[], from: number, opts: { rate: number; onParagraph?: (i: number) => void }) {
      speech.speakSequence(paragraphs.slice(from), {
        rate: opts.rate,
        onIndex: (i) => {
          setSpeaking(from + i);
          opts.onParagraph?.(from + i);
        },
        onEnd: () => setSpeaking(null),
      });
    },
    stop() {
      speech.stop();
      setSpeaking(null);
    },
  };
}

/** A story's comprehension questions; answers go into history as set "story:<id>". */
export function useStoryQuiz(story: Story, onFinished: () => void) {
  const api = useApi();
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const recorded = useRef(-1);
  const total = story.questions.length;
  const answered = Object.keys(results).length;
  const done = total > 0 && answered === total;
  const setId = storySetId(story.id);

  useEffect(() => {
    if (!done || recorded.current === round) return;
    recorded.current = round;
    // The server scores the quiz from the answers it graded.
    api.finishRun(setId, true).catch(() => {});
    onFinished();
  }, [api, done, round, setId, onFinished]);

  return {
    /** Changes on "Try again", so the questions can start over (e.g. as a key). */
    round,
    total,
    answered,
    correct: Object.values(results).filter(Boolean).length,
    done,
    async answer(item: ExerciseItem, response: ItemResponse): Promise<AnswerVerdict> {
      const v = await api.answer({ setId, itemId: item.id, response });
      setResults((r) => (item.id in r ? r : { ...r, [item.id]: v.correct }));
      return v;
    },
    retry() {
      setResults({});
      setRound((r) => r + 1);
    },
  };
}
