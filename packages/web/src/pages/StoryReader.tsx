import "@fontsource/literata/400.css";
import "@fontsource/literata/400-italic.css";
import "@fontsource/literata/600.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/400-italic.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "markdown-to-jsx";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  readerSettings as readerSettingsSchema,
  splitSentences,
  storyParagraphs,
  storySetId,
  type AnswerGrading,
  type ExerciseItem,
  type ReaderSettings,
  type Settings,
  type Story,
  type StoryView,
} from "@mdb/shared";
import { ExerciseItemView } from "../components/ExerciseItemView";
import { TapToTranslate } from "../components/TapToTranslate";
import { api } from "../lib/api";
import { speakSequence, stopSpeaking, ttsSupported } from "../lib/tts";
import { useVocab } from "../lib/vocab";

const FONTS: Record<ReaderSettings["font"], { label: string; family: string }> = {
  serif: { label: "Serif", family: '"Literata", Georgia, "Times New Roman", serif' },
  sans: { label: "Sans", family: '"Lato", ui-sans-serif, system-ui, sans-serif' },
  readable: { label: "Readable", family: '"Atkinson Hyperlegible", ui-sans-serif, system-ui, sans-serif' },
};
const LINE_HEIGHTS: Record<ReaderSettings["lineHeight"], number> = { compact: 1.5, normal: 1.75, relaxed: 2 };
const WIDTHS: Record<ReaderSettings["width"], string> = { narrow: "32rem", medium: "38rem", wide: "46rem" };
const THEMES: { id: ReaderSettings["theme"]; label: string; swatch: string }[] = [
  { id: "auto", label: "Auto", swatch: "linear-gradient(135deg,#fff 50%,#11141a 50%)" },
  { id: "light", label: "Light", swatch: "#ffffff" },
  { id: "sepia", label: "Sepia", swatch: "#f8f1e3" },
  { id: "dark", label: "Dark", swatch: "#11141a" },
];

/** The German text of a block, without its English translation lines. */
function germanText(el: HTMLElement | null): string {
  if (!el) return "";
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[data-translation]").forEach((n) => n.remove());
  return copy.textContent ?? "";
}

const wordRe = /[\p{L}ß]+(?:-[\p{L}ß]+)*/gu;
const minutes = (words: number) => Math.max(1, Math.round(words / 120));

/** CSS Custom Highlight API (no DOM changes); missing in older browsers. */
type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
const highlights = (): HighlightRegistry | null =>
  typeof CSS !== "undefined" && "highlights" in CSS && typeof (window as { Highlight?: unknown }).Highlight === "function"
    ? ((CSS as unknown as { highlights: HighlightRegistry }).highlights)
    : null;

/** One reader instance per story, so moving to the next chapter starts fresh. */
export function StoryReader() {
  const { id = "" } = useParams();
  return <StoryReaderView key={id} />;
}

function StoryReaderView() {
  const { id = "" } = useParams();
  const [view, setView] = useState<StoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reader, setReader] = useState<ReaderSettings>(() => readerSettingsSchema.parse({}));
  const [panel, setPanel] = useState(false);
  const [llmGrading, setLlmGrading] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  /** English lines per paragraph index (null = not translated yet). */
  const [lines, setLines] = useState<Record<number, string[] | null>>({});
  const [translating, setTranslating] = useState<Set<number>>(new Set());
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [lemmas, setLemmas] = useState<Record<string, string>>({});
  const articleRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { words: savedWords } = useVocab();

  useEffect(() => {
    api
      .story(id)
      .then(setView)
      .catch(() => setError("This story doesn't exist (or isn't yours)."));
    Promise.all([api.settings(), api.assistantStatus()])
      .then(([se, st]) => {
        setSettings(se);
        setReader(se.reader);
        setLlmGrading(Boolean(st.enabled && se.llmGrading));
        setAiEnabled(st.enabled);
      })
      .catch(() => {});
    return () => stopSpeaking();
  }, [id]);

  const story = view?.story;
  const blocks = useMemo(() => (story ? storyParagraphs(story.body) : []), [story]);
  const wordTotal = useMemo(() => (story ? (story.body.match(wordRe) ?? []).length : 0), [story]);

  // --- line-by-line translations: stored ones on open; missing ones for the
  // paragraphs on screen, a few at a time, with the learner's AI.
  const translationsOn = reader.translations !== "off";
  const hasAnyLines = Object.values(lines).some(Boolean);
  useEffect(() => {
    if (!story) return;
    api
      .storyTranslations(story.id)
      .then((t) => setLines(Object.fromEntries(t.paragraphs.map((p) => [p.index, p.lines]))))
      .catch(() => {});
  }, [story]);
  const queued = useRef(new Set<number>());
  const flushTimer = useRef<number>();
  const inFlight = useRef(new Set<number>());
  useEffect(() => {
    if (!story || !translationsOn || !aiEnabled || translateError) return;
    const flush = () => {
      const batch = [...queued.current].filter((i) => !inFlight.current.has(i)).slice(0, 4);
      queued.current.clear();
      if (!batch.length) return;
      batch.forEach((i) => inFlight.current.add(i));
      setTranslating(new Set(inFlight.current));
      api
        .translateStory(story.id, batch)
        .then((t) => setLines(Object.fromEntries(t.paragraphs.map((p) => [p.index, p.lines]))))
        .catch((e) => setTranslateError(e instanceof Error ? e.message : "Couldn't translate."))
        .finally(() => {
          batch.forEach((i) => inFlight.current.delete(i));
          setTranslating(new Set(inFlight.current));
        });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.index);
          if (e.isIntersecting && lines[i] === null && !inFlight.current.has(i)) queued.current.add(i);
        }
        window.clearTimeout(flushTimer.current);
        flushTimer.current = window.setTimeout(flush, 250);
      },
      { rootMargin: "200px 0px" },
    );
    blockRefs.current.forEach((el) => el && observer.observe(el));
    return () => {
      observer.disconnect();
      window.clearTimeout(flushTimer.current);
    };
  }, [story, translationsOn, aiEnabled, lines, translateError]);

  // Base forms of the story's words, so "ging" is underlined when "gehen" is saved.
  useEffect(() => {
    if (!story) return;
    const unique = [...new Set(story.body.match(wordRe) ?? [])].slice(0, 3000);
    api.lemmas(unique).then(setLemmas).catch(() => {});
  }, [story]);

  // --- reader settings: applied at once, saved to the account shortly after.
  // A change not saved yet is saved on leaving the page, so it isn't lost.
  const saveTimer = useRef<number>();
  const pendingSave = useRef<Settings | null>(null);
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const updated = pendingSave.current;
    pendingSave.current = null;
    if (updated) api.saveSettings(updated, { keepalive: true }).catch(() => {});
  }, []);
  useEffect(() => {
    window.addEventListener("pagehide", flushSave);
    return () => {
      window.removeEventListener("pagehide", flushSave);
      flushSave();
    };
  }, [flushSave]);
  function changeReader(patch: Partial<ReaderSettings>) {
    const next = { ...reader, ...patch };
    setReader(next);
    if (!settings) return;
    const updated = { ...settings, reader: next };
    setSettings(updated);
    pendingSave.current = updated;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushSave, 600);
  }

  // --- saved-word underlines.
  useEffect(() => {
    const reg = highlights();
    const root = articleRef.current;
    if (!reg || !root) return;
    reg.delete("saved-vocab");
    if (!reader.highlightVocab || savedWords.size === 0) return;
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("[data-translation]")) continue;
      const text = node.textContent ?? "";
      for (const m of text.matchAll(wordRe)) {
        const w = m[0];
        const lemma = lemmas[w];
        if (savedWords.has(w.toLowerCase()) || (lemma && savedWords.has(lemma.toLowerCase()))) {
          const r = document.createRange();
          r.setStart(node, m.index!);
          r.setEnd(node, m.index! + w.length);
          ranges.push(r);
        }
      }
    }
    const HighlightCtor = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
    reg.set("saved-vocab", new HighlightCtor(...ranges));
    return () => reg.delete("saved-vocab");
  }, [reader.highlightVocab, savedWords, lemmas, blocks, reader.font, reader.size, reader.translations, lines]);

  // --- reading position: restored once, then saved as you scroll.
  const progress = useRef(0);
  const savedProgress = useRef(0);
  const restored = useRef(false);
  const measure = useCallback(() => {
    const el = articleRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const seen = window.innerHeight - rect.top;
    return Math.min(1, Math.max(0, seen / rect.height));
  }, []);
  useEffect(() => {
    if (!view || restored.current || !articleRef.current) return;
    restored.current = true;
    progress.current = savedProgress.current = view.progress;
    if (view.progress > 0.05 && view.progress < 0.97 && !view.readAt) {
      const el = articleRef.current;
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + view.progress * el.offsetHeight - window.innerHeight });
    }
  }, [view]);
  useEffect(() => {
    if (!view) return;
    const save = () => {
      if (Math.abs(progress.current - savedProgress.current) < 0.02) return;
      savedProgress.current = progress.current;
      api.storyProgress(view.story.id, Math.round(progress.current * 1000) / 1000).catch(() => {});
    };
    const onScroll = () => {
      progress.current = Math.max(progress.current, measure());
    };
    const timer = window.setInterval(save, 2000);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearInterval(timer);
      save();
    };
  }, [view, measure]);

  // --- read aloud.
  function readFrom(start: number) {
    const texts = blockRefs.current.slice(start).map(germanText);
    speakSequence(texts, {
      rate: reader.speechRate,
      onIndex: (i) => {
        const idx = start + i;
        setSpeaking(idx);
        const el = blockRefs.current[idx];
        const r = el?.getBoundingClientRect();
        if (el && r && (r.top < 80 || r.bottom > window.innerHeight - 96)) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      },
      onEnd: () => setSpeaking(null),
    });
  }
  function playFromView() {
    const first = blockRefs.current.findIndex((el) => el && el.getBoundingClientRect().bottom > 80);
    readFrom(Math.max(0, first));
  }
  function stop() {
    stopSpeaking();
    setSpeaking(null);
  }

  const navigate = useNavigate();
  /** "Next chapter": finishing this one counts as having read it. */
  async function nextChapter() {
    if (!view?.series?.next) return;
    if (!view.readAt) await markRead(true).catch(() => {});
    navigate(`/stories/${view.series.next}`);
    window.scrollTo({ top: 0 });
  }

  async function markRead(read: boolean) {
    if (!view) return;
    await api.storyProgress(view.story.id, read ? 1 : progress.current, read);
    setView({ ...view, readAt: read ? Math.floor(Date.now() / 1000) : null });
  }

  if (error) {
    return (
      <div>
        <Link to="/stories" className="text-sm text-slate-500 hover:underline">
          ← Stories
        </Link>
        <p className="mt-4 text-red-600">{error}</p>
      </div>
    );
  }
  if (!view || !story) return <p className="text-slate-500">Loading…</p>;

  const book = view.series;
  const canSpeak = ttsSupported();
  const toolBtn =
    "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm hover:border-slate-500 dark:border-slate-700";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          to={book ? `/series/${book.id}` : "/stories"}
          className="mr-auto min-w-0 truncate text-sm text-slate-500 hover:underline"
        >
          ← {book ? book.title : "Stories"}
        </Link>
        {canSpeak &&
          (speaking === null ? (
            <button type="button" onClick={playFromView} className={toolBtn} title="Read aloud from here">
              ▶ Listen
            </button>
          ) : (
            <button type="button" onClick={stop} className={toolBtn}>
              ■ Stop
            </button>
          ))}
        {(aiEnabled || hasAnyLines) && (
          <button
            type="button"
            onClick={() => {
              setTranslateError(null);
              changeReader({
                translations: reader.translations === "off" ? "peek" : reader.translations === "peek" ? "always" : "off",
              });
            }}
            className={`${toolBtn} ${translationsOn ? "bg-slate-100 dark:bg-slate-800" : ""}`}
            title="English line by line: off → peek (tap to reveal) → always"
          >
            EN{reader.translations === "peek" ? " · peek" : reader.translations === "always" ? " · on" : ""}
          </button>
        )}
        <button
          type="button"
          onClick={() => setPanel((p) => !p)}
          className={`${toolBtn} ${panel ? "bg-slate-100 dark:bg-slate-800" : ""}`}
          aria-expanded={panel}
          title="Text settings"
        >
          Aa
        </button>
        <Link to={`/stories/${story.id}/edit`} className={toolBtn}>
          Edit
        </Link>
      </div>

      {panel && (
        <ReaderPanel value={reader} onChange={changeReader} canSpeak={canSpeak} canTranslate={aiEnabled || hasAnyLines} />
      )}
      {translationsOn && translateError && (
        <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {translateError}{" "}
          <button type="button" className="underline" onClick={() => setTranslateError(null)}>
            Try again
          </button>
        </p>
      )}

      <article className="reader rounded-2xl px-5 py-8 sm:px-10" data-theme={reader.theme} lang="de">
        <div
          className="mx-auto"
          style={{
            maxWidth: WIDTHS[reader.width],
            fontFamily: FONTS[reader.font].family,
            fontSize: `${reader.size}px`,
            lineHeight: LINE_HEIGHTS[reader.lineHeight],
          }}
        >
          <header className="mb-6">
            {book && (
              <p className="reader-muted mb-1 font-sans text-xs uppercase tracking-wide" lang="en">
                Chapter {book.chapter} of {book.total}
              </p>
            )}
            <h1 className="text-[1.6em] font-semibold leading-tight">{story.title}</h1>
            {story.subtitle && <p className="reader-muted mt-1 text-[0.8em]" lang="en">{story.subtitle}</p>}
            <p className="reader-muted mt-2 font-sans text-xs" lang="en">
              {story.level} · {minutes(wordTotal)} min · {wordTotal} words
              {view.readAt ? " · read ✓" : ""}
            </p>
          </header>

          {story.glossary.length > 0 && <Glossary entries={story.glossary} />}

          <TapToTranslate>
            <div ref={articleRef} className="reader-text">
              {blocks.map((b, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    blockRefs.current[i] = el;
                  }}
                  data-index={i}
                  className={`reader-block group relative ${speaking === i ? "is-speaking" : ""}`}
                >
                  {canSpeak && (
                    <button
                      type="button"
                      data-no-tap
                      onClick={() => readFrom(i)}
                      aria-label="Read aloud from this paragraph"
                      title="Read aloud from here"
                      className="reader-muted absolute -left-9 top-0.5 hidden h-7 w-7 place-items-center rounded-lg opacity-0 transition group-hover:opacity-100 focus:opacity-100 md:grid"
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
                        <path d="M15.5 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                  {translationsOn ? (
                    <TranslatedBlock
                      block={b}
                      lines={lines[i] ?? null}
                      loading={translating.has(i)}
                      peek={reader.translations === "peek"}
                      revealed={revealed}
                      onReveal={(k) => setRevealed((r) => new Set(r).add(k))}
                      blockKey={i}
                    />
                  ) : (
                    <Markdown options={{ forceBlock: true }}>{b}</Markdown>
                  )}
                </div>
              ))}
            </div>
          </TapToTranslate>

          <div className="mt-8 flex flex-wrap items-center gap-3 border-t pt-5 font-sans text-sm reader-rule" lang="en">
            {view.readAt ? (
              <>
                <span className="text-green-600 dark:text-green-400">You've read this ✓</span>
                <button type="button" onClick={() => void markRead(false)} className="reader-muted underline">
                  Mark as unread
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void markRead(true)}
                className={
                  book?.next
                    ? "reader-muted underline"
                    : "rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground"
                }
              >
                Finished reading
              </button>
            )}
            {book && (
              <span className="ml-auto flex items-center gap-3">
                {book.prev && (
                  <Link to={`/stories/${book.prev}`} className="reader-muted underline">
                    ← Previous
                  </Link>
                )}
                {book.next ? (
                  <button
                    type="button"
                    onClick={() => void nextChapter()}
                    className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground"
                  >
                    Next chapter →
                  </button>
                ) : (
                  <Link to={`/series/${book.id}`} className="reader-muted underline">
                    {book.chapter < book.total ? "More chapters coming" : "Back to the book"}
                  </Link>
                )}
              </span>
            )}
          </div>
        </div>
      </article>

      {story.questions.length > 0 && (
        <StoryQuiz story={story} llmGrading={llmGrading} onFinished={() => !view.readAt && void markRead(true)} />
      )}

      {speaking !== null && (
        <button
          type="button"
          onClick={stop}
          className="fixed bottom-20 right-4 z-40 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground shadow-lg md:bottom-6"
        >
          ■ Stop reading
        </button>
      )}
    </div>
  );
}

function Glossary({ entries }: { entries: Story["glossary"] }) {
  return (
    <details className="reader-rule mb-6 rounded-xl border px-4 py-2 font-sans text-sm">
      <summary className="cursor-pointer select-none py-1 font-medium" lang="en">Glossary ({entries.length})</summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pb-2 pt-1">
        {entries.map((g) => (
          <div key={g.term} className="contents">
            <dt className="font-semibold">{g.term}</dt>
            <dd className="reader-muted" lang="en">{g.meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`rounded-md px-2.5 py-1 text-sm ${
            value === o.id ? "bg-accent text-accent-foreground" : "text-slate-600 dark:text-slate-300"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ReaderPanel({
  value,
  onChange,
  canSpeak,
  canTranslate,
}: {
  value: ReaderSettings;
  onChange: (p: Partial<ReaderSettings>) => void;
  canSpeak: boolean;
  canTranslate: boolean;
}) {
  const row = "flex flex-wrap items-center justify-between gap-2";
  const label = "text-sm text-slate-500";
  return (
    <div className="mb-3 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className={row}>
        <span className={label}>Font</span>
        <Segmented
          value={value.font}
          options={(Object.keys(FONTS) as ReaderSettings["font"][]).map((id) => ({ id, label: FONTS[id].label }))}
          onChange={(font) => onChange({ font })}
        />
      </div>
      <div className={row}>
        <span className={label}>Size</span>
        <div className="flex items-center gap-2">
          <button type="button" className="h-8 w-8 rounded-lg border border-slate-300 text-sm dark:border-slate-700" onClick={() => onChange({ size: Math.max(14, value.size - 1) })} aria-label="Smaller text">
            A−
          </button>
          <span className="w-10 text-center text-sm tabular-nums">{value.size}px</span>
          <button type="button" className="h-8 w-8 rounded-lg border border-slate-300 text-base dark:border-slate-700" onClick={() => onChange({ size: Math.min(30, value.size + 1) })} aria-label="Larger text">
            A+
          </button>
        </div>
      </div>
      <div className={row}>
        <span className={label}>Line spacing</span>
        <Segmented
          value={value.lineHeight}
          options={[
            { id: "compact", label: "Compact" },
            { id: "normal", label: "Normal" },
            { id: "relaxed", label: "Relaxed" },
          ]}
          onChange={(lineHeight) => onChange({ lineHeight })}
        />
      </div>
      <div className={row}>
        <span className={label}>Width</span>
        <Segmented
          value={value.width}
          options={[
            { id: "narrow", label: "Narrow" },
            { id: "medium", label: "Medium" },
            { id: "wide", label: "Wide" },
          ]}
          onChange={(width) => onChange({ width })}
        />
      </div>
      <div className={row}>
        <span className={label}>Theme</span>
        <div className="flex gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange({ theme: t.id })}
              title={t.label}
              aria-label={`${t.label} theme`}
              aria-pressed={value.theme === t.id}
              className={`h-8 w-8 rounded-full border ${
                value.theme === t.id ? "ring-2 ring-accent ring-offset-2 dark:ring-offset-slate-900" : ""
              } border-slate-300 dark:border-slate-600`}
              style={{ background: t.swatch }}
            />
          ))}
        </div>
      </div>
      <label className={`${row} cursor-pointer`}>
        <span className={label}>Underline words I've saved</span>
        <input
          type="checkbox"
          checked={value.highlightVocab}
          onChange={(e) => onChange({ highlightVocab: e.target.checked })}
          className="h-4 w-4"
        />
      </label>
      {canSpeak && (
        <div className={row}>
          <span className={label}>Reading speed</span>
          <Segmented
            value={String(value.speechRate)}
            options={[
              { id: "0.75", label: "Slow" },
              { id: "0.95", label: "Normal" },
              { id: "1.15", label: "Fast" },
            ]}
            onChange={(r) => onChange({ speechRate: Number(r) })}
          />
        </div>
      )}
      {canTranslate && (
        <div className={row}>
          <span className={label}>English line by line</span>
          <Segmented
            value={value.translations}
            options={[
              { id: "off", label: "Off" },
              { id: "peek", label: "Peek" },
              { id: "always", label: "Always" },
            ]}
            onChange={(translations) => onChange({ translations })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A paragraph with its English: under each sentence when they match one to
 * one, else under the paragraph. "Peek" blurs each line until it's tapped.
 * English lines are marked data-translation (skipped by read-aloud and the
 * saved-word underlines) and data-no-tap (no dictionary popup).
 */
function TranslatedBlock({
  block,
  lines,
  loading,
  peek,
  revealed,
  onReveal,
  blockKey,
}: {
  block: string;
  lines: string[] | null;
  loading: boolean;
  peek: boolean;
  revealed: Set<string>;
  onReveal: (key: string) => void;
  blockKey: number;
}) {
  const sentences = useMemo(() => splitSentences(block), [block]);
  const english = (text: string, k: string) => {
    const hidden = peek && !revealed.has(k);
    return (
      <span
        data-translation
        data-no-tap
        lang="en"
        role={hidden ? "button" : undefined}
        tabIndex={hidden ? 0 : undefined}
        aria-label={hidden ? "Show the English" : undefined}
        onClick={() => hidden && onReveal(k)}
        onKeyDown={(e) => hidden && (e.key === "Enter" || e.key === " ") && onReveal(k)}
        className={`reader-translation ${hidden ? "is-hidden" : ""}`}
      >
        {text}
      </span>
    );
  };
  if (lines && lines.length === sentences.length && sentences.length > 1) {
    return (
      <p>
        {sentences.map((s, j) => (
          <span key={j} className="reader-sentence">
            <Markdown options={{ forceInline: true }}>{s}</Markdown> {english(lines[j]!, `${blockKey}:${j}`)}
          </span>
        ))}
      </p>
    );
  }
  return (
    <>
      <Markdown options={{ forceBlock: true }}>{block}</Markdown>
      {lines ? (
        <div className="-mt-[0.6em] mb-[1em]">{english(lines.join(" "), `${blockKey}:all`)}</div>
      ) : loading ? (
        <div data-translation className="reader-translation-loading -mt-[0.6em] mb-[1em]" aria-label="Translating" />
      ) : null}
    </>
  );
}

/** Comprehension questions; answers go into history as set "story:<id>". */
function StoryQuiz({
  story,
  llmGrading,
  onFinished,
}: {
  story: Story;
  llmGrading: boolean;
  onFinished: () => void;
}) {
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const recorded = useRef(-1);
  const total = story.questions.length;
  const correct = Object.values(results).filter(Boolean).length;
  const done = Object.keys(results).length === total;
  const setId = storySetId(story.id);

  useEffect(() => {
    if (!done || recorded.current === round) return;
    recorded.current = round;
    api
      .recordRun({ setId, setTitle: story.title, total, answered: total, correct, results })
      .catch(() => {});
    onFinished();
  }, [done, round, setId, story.title, total, correct, results, onFinished]);

  function answer(item: ExerciseItem, ok: boolean, response?: string, grading: AnswerGrading = "auto") {
    if (item.id in results) return;
    setResults((r) => ({ ...r, [item.id]: ok }));
    void api.recordAttempt({ setId, itemId: item.id, correct: ok, response, grading }).catch(() => {});
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Fragen zum Text</h2>
        <span className="text-sm text-slate-500">
          {Object.keys(results).length}/{total}
        </span>
      </div>
      <TapToTranslate className="space-y-3">
        {story.questions.map((q, i) => (
          <div
            key={`${round}-${q.id}`}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="mb-2 text-xs font-medium text-slate-400">Frage {i + 1}</p>
            <ExerciseItemView
              item={q}
              llmGrading={llmGrading}
              onAnswered={(ok, response, grading) => answer(q, ok, response, grading)}
            />
          </div>
        ))}
      </TapToTranslate>
      {done && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <span className="font-medium">
            {correct}/{total} richtig
          </span>
          <button
            type="button"
            onClick={() => {
              setResults({});
              setRound((r) => r + 1);
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
          >
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
