import "@fontsource/literata/400.css";
import "@fontsource/literata/400-italic.css";
import "@fontsource/literata/600.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/400-italic.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Markdown from "markdown-to-jsx";
import { Link, useNavigate, useParams } from "react-router-dom";
import { splitSentences, storyParagraphs, type ReaderSettings, type Story } from "@mdb/shared";
import { audioProgressText } from "@mdb/client";
import {
  isSavedWord,
  storyWordRe,
  useAssistantEnabled,
  useReadAloud,
  useReaderSettings,
  useReadingProgress,
  useStory,
  useStoryLemmas,
  useStoryQuiz,
  useStoryTranslations,
} from "@mdb/client/react";
import { ExerciseItemView } from "../components/ExerciseItemView";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlossaryIcon,
  LanguagesIcon,
  MaximizeIcon,
  MinimizeIcon,
  RetryIcon,
  SpeakerIcon,
  StopIcon,
  CrossIcon,
  HeadphonesIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  ChevronUpIcon,
  TypeIcon,
} from "../components/icons";
import { TapToTranslate } from "../components/TapToTranslate";
import { btn, card } from "../components/ui";
import { api } from "../lib/api";
import { clock, listen, pause as pauseListening, resume as resumeListening, seekParagraph, openPlayer, stop as stopListening, useListening } from "../lib/listening";
import { isEink, scrollBehavior } from "../lib/appearance";
import { useVocab } from "../lib/vocab";

const FONTS: Record<ReaderSettings["font"], { label: string; family: string }> = {
  serif: { label: "Serif", family: '"Literata", Georgia, "Times New Roman", serif' },
  sans: { label: "Sans", family: '"Lato", ui-sans-serif, system-ui, sans-serif' },
  readable: { label: "Readable", family: '"Atkinson Hyperlegible", ui-sans-serif, system-ui, sans-serif' },
  libron: { label: "Libron", family: '"Libron", "Literata", Georgia, serif' },
};
const LINE_HEIGHTS: Record<ReaderSettings["lineHeight"], number> = { compact: 1.5, normal: 1.75, relaxed: 2 };
const WIDTHS: Record<ReaderSettings["width"], string> = { narrow: "32rem", medium: "38rem", wide: "46rem" };
/** The same widths in px, for the page columns. */
const WIDTH_PX: Record<ReaderSettings["width"], number> = { narrow: 512, medium: 608, wide: 736 };
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
  const { view, error, showRead, markRead, readAgain: unread, nextChapter: toNextChapter } = useStory(id);
  const { reader, change: changeReader, flush: flushSettings } = useReaderSettings();
  const aiEnabled = useAssistantEnabled();
  const aloud = useReadAloud();
  const navigate = useNavigate();
  // Listening (a server reading voice): one audio file, the page-wide player (lib/listening).
  const ls = useListening();
  const listeningHere = ls.storyId === id && ls.phase !== "idle";
  const speaking = listeningHere ? ls.paragraph : aloud.speaking;
  const articleRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { words: savedWords } = useVocab();

  // --- layout state: pages (CSS columns in a clipped box) or scroll.
  const paged = reader.layout === "pages";
  const scrollerRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [colWidth, setColWidth] = useState(0);
  const [blockPages, setBlockPages] = useState<number[]>([]);
  /** The page each paragraph ends on (it may continue onto the next). */
  const blockEnds = useRef<number[]>([]);
  /** Set when a re-flow moves the page: it mustn't move the anchor too. */
  const reflowing = useRef(false);
  /** The top bar and page counter (hidden while reading). */
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<"settings" | "glossary" | null>(null);
  const pageRef = useRef(0);
  pageRef.current = page;
  const countRef = useRef(1);
  countRef.current = pageCount;
  const blockPagesRef = useRef<number[]>([]);
  blockPagesRef.current = blockPages;

  const story = view?.story;
  const blocks = useMemo(() => (story ? storyParagraphs(story.body) : []), [story]);

  // --- line-by-line translations: stored ones on open; missing ones for the
  // paragraphs on screen, a few at a time, with the learner's AI.
  const translationsOn = reader.translations !== "off";
  const tr = useStoryTranslations({ storyId: story?.id, enabled: aiEnabled });
  const { lines, translating, revealed, request: requestLines } = tr;
  const hasAnyLines = tr.hasAny;
  // Scroll: paragraphs as they come into view.
  useEffect(() => {
    if (!translationsOn || paged) return;
    const observer = new IntersectionObserver(
      (entries) =>
        requestLines(entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.index))),
      { root: scrollerRef.current, rootMargin: "200px 0px" },
    );
    blockRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [translationsOn, paged, requestLines, lines]);
  // Pages: what's on this page and the next.
  useEffect(() => {
    if (!translationsOn || !paged || !blockPages.length) return;
    requestLines(
      blockPages.flatMap((start, i) => (start <= page + 1 && (blockPages[i + 1] ?? pageCount) >= page ? [i] : [])),
    );
  }, [translationsOn, paged, page, pageCount, blockPages, requestLines, lines]);

  // Base forms of the story's words, so "ging" is underlined when "gehen" is saved.
  const lemmas = useStoryLemmas(story?.body);

  // A reader-settings change not saved yet is saved when the page is closing.
  useEffect(() => {
    window.addEventListener("pagehide", flushSettings);
    return () => window.removeEventListener("pagehide", flushSettings);
  }, [flushSettings]);

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
      for (const m of text.matchAll(storyWordRe)) {
        const w = m[0];
        if (isSavedWord(w, savedWords, lemmas)) {
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

  // --- reading position and layout ---------------------------------------
  // `anchor` is the first paragraph on screen: a re-flow (font, size, window,
  // translations) or switching pages ↔ scroll keeps you on it.
  const anchor = useRef(0);
  const reading = useReadingProgress(view);
  const restored = useRef(false);
  const GAP = 48;
  const step = colWidth + GAP;

  /** Pages: measure the column flow — page count, and where each paragraph starts. */
  const relayout = useCallback(() => {
    const area = areaRef.current;
    const flow = flowRef.current;
    if (!paged || !area || !flow || !view) return;
    const width = Math.max(200, Math.min(WIDTH_PX[reader.width], area.clientWidth - 40));
    flow.style.width = `${width}px`;
    flow.style.height = `${area.clientHeight}px`;
    flow.style.columnWidth = `${width}px`;
    flow.style.columnGap = `${GAP}px`;
    const s = width + GAP;
    const base = flow.getBoundingClientRect().left;
    const pageOf = (r: DOMRect | undefined) => (r ? Math.max(0, Math.floor((r.left - base + 1) / s)) : 0);
    const starts = blockRefs.current.map((el) => pageOf(el?.getClientRects()[0]));
    blockEnds.current = blockRefs.current.map((el) => {
      const rects = el?.getClientRects();
      return rects?.length ? pageOf(rects[rects.length - 1]) : 0;
    });
    const count = Math.max(1, Math.ceil((flow.scrollWidth + GAP) / s));
    const wasEnd = restored.current && pageRef.current >= countRef.current;
    setColWidth(width);
    setPageCount(count);
    setBlockPages(starts);
    reflowing.current = restored.current;
    if (!restored.current) {
      restored.current = true;
      // The server says where to reopen (null: at the top).
      const p = view.resumeAt;
      setPage(p === null ? 0 : Math.min(count - 1, Math.floor(p * count)));
    } else {
      setPage(wasEnd ? count : Math.min(count - 1, starts[anchor.current] ?? 0));
    }
  }, [paged, reader.width, view]);

  useLayoutEffect(() => {
    relayout();
  }, [relayout, blocks, reader.font, reader.size, reader.lineHeight, reader.translations, lines, revealed]);
  useEffect(() => {
    const area = areaRef.current;
    if (!paged || !area) return;
    const ro = new ResizeObserver(() => relayout());
    ro.observe(area);
    // Web fonts arrive after the first layout and change the text's size.
    void document.fonts?.ready.then(() => relayout());
    return () => ro.disconnect();
  }, [paged, relayout]);

  // Pages: the anchor follows the pages you turn (not re-flows); so does progress.
  useEffect(() => {
    if (!paged || !blockPages.length) return;
    if (reflowing.current) reflowing.current = false;
    else if (page < pageCount) anchor.current = firstOnPage(blockEnds.current, page);
    // Pages turned past count as read (the page you're on doesn't yet); the
    // end page counts as all of it.
    reading.see(page / pageCount);
  }, [paged, page, pageCount, blockPages]);

  const turn = useCallback((delta: number) => {
    setPage((p) => Math.max(0, Math.min(countRef.current, p + delta)));
    setChrome(false);
    setSheet(null);
  }, []);

  // Scroll: restore / keep the anchor, track progress, hide the bars going down.
  const scrollTo = useCallback((i: number) => {
    const sc = scrollerRef.current;
    const el = blockRefs.current[i];
    if (sc && el) sc.scrollTop = Math.max(0, el.offsetTop - 64);
  }, []);
  useLayoutEffect(() => {
    if (paged || !view || !scrollerRef.current || !articleRef.current) return;
    if (!restored.current) {
      restored.current = true;
      const sc = scrollerRef.current;
      const el = articleRef.current;
      if (view.resumeAt !== null) {
        sc.scrollTop = el.offsetTop + view.resumeAt * el.offsetHeight - sc.clientHeight;
      }
    } else {
      scrollTo(anchor.current);
    }
  }, [paged, view, scrollTo]);
  useEffect(() => {
    const sc = scrollerRef.current;
    if (paged || !sc) return;
    let last = sc.scrollTop;
    const onScroll = () => {
      const el = articleRef.current;
      if (el) {
        const seen = sc.scrollTop + sc.clientHeight - el.offsetTop;
        reading.see(seen / el.offsetHeight);
      }
      const i = blockRefs.current.findIndex((b) => b && b.offsetTop + b.offsetHeight > sc.scrollTop + 64);
      if (i >= 0) anchor.current = i;
      const d = sc.scrollTop - last;
      if (Math.abs(d) > 8) {
        setChrome(d < 0 || sc.scrollTop < 40);
        last = sc.scrollTop;
      }
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => sc.removeEventListener("scroll", onScroll);
  }, [paged, view]);

  // Keyboard: arrows / space / page keys turn pages; Escape closes a sheet.
  // Volume keys too, where the device passes them to the page (most phone
  // browsers keep them for the volume; page-turner remotes send arrows).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable]")) return;
      if (e.key === "Escape") setSheet(null);
      if (!paged) return;
      if (["ArrowRight", "PageDown", " ", "AudioVolumeDown", "VolumeDown"].includes(e.key)) {
        e.preventDefault();
        turn(1);
      } else if (["ArrowLeft", "PageUp", "AudioVolumeUp", "VolumeUp"].includes(e.key)) {
        e.preventDefault();
        turn(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paged, turn]);

  // Swipes (touch/pen) turn pages; the click that ends a swipe is swallowed.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  // A tap that isn't on a word: the outer quarters turn the page, the middle
  // shows or hides the bars. (Words anywhere on the page stay tappable.)
  const tapAt = useCallback(
    (x: number) => {
      const area = areaRef.current;
      if (paged && area) {
        const r = area.getBoundingClientRect();
        const at = (x - r.left) / r.width;
        if (at < 0.25 && pageRef.current > 0) return turn(-1);
        if (at > 0.75 && pageRef.current < countRef.current) return turn(1);
      }
      setChrome((c) => !c);
    },
    [paged, turn],
  );

  // The reader owns the screen while it's open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Full screen (hides the browser's bars too, where supported).
  const canFullscreen = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }

  // --- read aloud: follows along by turning pages / scrolling.
  function follow(idx: number) {
    if (paged) {
      const p = blockPagesRef.current[idx];
      if (p !== undefined && p !== pageRef.current) setPage(p);
      return;
    }
    const sc = scrollerRef.current;
    const el = blockRefs.current[idx];
    if (sc && el && (el.offsetTop < sc.scrollTop + 64 || el.offsetTop + el.offsetHeight > sc.scrollTop + sc.clientHeight - 48)) {
      el.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    }
  }
  function readFrom(start: number) {
    if (ls.enabled && view) {
      // A server reading voice: listen to the story's audio file instead.
      aloud.stop();
      if (listeningHere) return seekParagraph(start);
      return void listen({ id: view.story.id, title: view.story.title, book: view.series?.title ?? null }, start);
    }
    aloud.read(blockRefs.current.map(germanText), start, { rate: reader.speechRate, onParagraph: follow });
  }
  function playFromView() {
    if (listeningHere) return ls.phase === "playing" ? pauseListening() : resumeListening();
    readFrom(anchor.current);
  }
  const stop = () => (listeningHere ? stopListening() : aloud.stop());
  useEffect(() => {
    if (listeningHere && ls.phase === "playing") follow(ls.paragraph);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listeningHere, ls.phase, ls.paragraph]);
  // The player went on to the next chapter: so does the reader.
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && ls.storyId && ls.storyId !== id && ls.storyId === view?.series?.next) navigate(`/stories/${ls.storyId}`);
    wasListening.current = ls.storyId === id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ls.storyId, id, view?.series?.next]);

  async function nextChapter() {
    const next = await toNextChapter();
    if (next) navigate(`/stories/${next}`);
  }

  /** "Read again": unread, back to the start, here and on the server. */
  async function readAgain() {
    await unread();
    anchor.current = 0;
    reading.reset();
    if (paged) setPage(0);
    else if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }

  if (error || !view || !story) {
    return (
      <div className="reader fixed inset-0 z-40 grid place-items-center p-6 text-center" data-theme={reader.theme}>
        {error ? (
          <div>
            <p className="mb-3">{error}</p>
            <Link to="/stories" className="inline-flex items-center gap-1 underline underline-offset-2">
              <ChevronLeftIcon className="h-4 w-4" />
              Stories
            </Link>
          </div>
        ) : (
          <p className="reader-muted">Loading…</p>
        )}
      </div>
    );
  }

  const book = view.series;
  const canSpeak = aloud.supported;
  const atEnd = paged && page >= pageCount;
  const iconBtn =
    "grid h-9 min-w-9 place-items-center rounded-control px-2 text-sm transition-colors reader-hover";
  const typography: React.CSSProperties = {
    fontFamily: FONTS[reader.font].family,
    fontSize: `${reader.size}px`,
    lineHeight: LINE_HEIGHTS[reader.lineHeight],
  };

  const text = (
    <TapToTranslate onMiss={(e) => tapAt(e.clientX)}>
      <div ref={articleRef} className="reader-text">
        <header className="mb-[1.2em]">
          {book && (
            <p className="reader-muted mb-1 font-sans text-xs uppercase tracking-wide" lang="en">
              Chapter {book.chapter} of {book.total}
            </p>
          )}
          <h1 className="text-[1.45em] font-semibold leading-tight">{story.title}</h1>
          <p className="reader-muted mt-1 font-sans text-xs" lang="en">
            {story.subtitle ? `${story.subtitle} · ` : ""}
            {story.level} · {view.minutes} min
            {view.readAt ? " · read" : ""}
          </p>
        </header>
        {blocks.map((b, i) => (
          <div
            key={i}
            ref={(el) => {
              blockRefs.current[i] = el;
            }}
            data-index={i}
            className={`reader-block group relative ${speaking === i ? "is-speaking" : ""}`}
          >
            {canSpeak && !paged && (
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
                onReveal={tr.reveal}
                blockKey={i}
              />
            ) : (
              <Markdown options={{ forceBlock: true }}>{b}</Markdown>
            )}
          </div>
        ))}
      </div>
    </TapToTranslate>
  );

  const ending = (
    <div className="font-sans text-sm" lang="en">
      <div className="reader-rule flex flex-wrap items-center gap-3 border-t pt-5">
        {view.readAt ? (
          <>
            <span className="inline-flex items-center gap-1.5 font-medium text-success">
              <CheckIcon className="h-4 w-4" />
              You've read this
            </span>
            <button type="button" onClick={() => void readAgain()} className="reader-muted underline">
              Read again
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void markRead()}
            className={book?.next ? "reader-muted underline underline-offset-2" : btn.primary}
          >
            {!book?.next && <CheckIcon className="h-4 w-4" />}
            Finished reading
          </button>
        )}
        {book && (
          <span className="ml-auto flex items-center gap-3">
            {book.prev && (
              <Link to={`/stories/${book.prev}`} className="reader-muted inline-flex items-center gap-1 underline-offset-2 hover:underline">
                <ChevronLeftIcon className="h-4 w-4" />
                Previous
              </Link>
            )}
            {book.next ? (
              <button
                type="button"
                onClick={() => void nextChapter()}
                className={btn.primary}
              >
                Next chapter
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            ) : (
              <Link to={`/series/${book.id}`} className="reader-muted underline">
                {book.chapter < book.total ? "More chapters coming" : "Back to the book"}
              </Link>
            )}
          </span>
        )}
      </div>
      {story.questions.length > 0 && (
        <StoryQuiz story={story} onFinished={showRead} />
      )}
    </div>
  );

  return (
    <div className="reader fixed inset-0 z-40 overflow-hidden" data-theme={reader.theme} lang="de">
      {/* Top bar: hides while reading; a tap on the page (not a word) brings it back. */}
      <div
        className={`reader-bar absolute inset-x-0 top-0 z-20 transition-transform duration-200 ${
          chrome || sheet ? "" : "-translate-y-full"
        }`}
        lang="en"
      >
        <div className="mx-auto flex h-12 max-w-4xl items-center gap-1 px-2">
          <Link
            to={book ? `/series/${book.id}` : "/stories"}
            className="reader-muted mr-auto flex min-w-0 items-center gap-1 rounded-control px-2 py-1.5 text-sm font-medium transition-colors reader-hover"
          >
            <ChevronLeftIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{book ? book.title : "Stories"}</span>
          </Link>
          {ls.enabled ? (
            <button
              type="button"
              onClick={playFromView}
              className={iconBtn}
              title={listeningHere && ls.phase === "playing" ? "Pause" : "Listen from here"}
              aria-label={listeningHere && ls.phase === "playing" ? "Pause listening" : "Listen from here"}
            >
              {listeningHere && ls.phase === "playing" ? <PauseIcon className="h-[18px] w-[18px]" /> : <HeadphonesIcon className="h-[18px] w-[18px]" />}
            </button>
          ) : (
            canSpeak &&
            (speaking === null ? (
              <button type="button" onClick={playFromView} className={iconBtn} title="Read aloud from here" aria-label="Read aloud">
                <SpeakerIcon className="h-[18px] w-[18px]" />
              </button>
            ) : (
              <button type="button" onClick={stop} className={iconBtn} aria-label="Stop reading aloud">
                <StopIcon className="h-[18px] w-[18px]" />
              </button>
            ))
          )}
          {(aiEnabled || hasAnyLines) && (
            <button
              type="button"
              onClick={() => {
                tr.clearError();
                changeReader({
                  translations: reader.translations === "off" ? "peek" : reader.translations === "peek" ? "always" : "off",
                });
              }}
              className={`${iconBtn} font-medium ${translationsOn ? "reader-pressed" : ""}`}
              title="English line by line: off → peek (tap to reveal) → always"
            >
              <span className="inline-flex items-center gap-1">
                <LanguagesIcon className="h-[18px] w-[18px]" />
                <span className="text-xs">{reader.translations === "peek" ? "Peek" : reader.translations === "always" ? "On" : ""}</span>
              </span>
            </button>
          )}
          {story.glossary.length > 0 && (
            <button
              type="button"
              onClick={() => setSheet((s) => (s === "glossary" ? null : "glossary"))}
              className={`${iconBtn} ${sheet === "glossary" ? "reader-pressed" : ""}`}
              aria-label="Glossary"
              title="Glossary"
            >
              <GlossaryIcon className="h-[18px] w-[18px]" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setSheet((s) => (s === "settings" ? null : "settings"))}
            className={`${iconBtn} ${sheet === "settings" ? "reader-pressed" : ""}`}
            aria-expanded={sheet === "settings"}
            aria-label="Text settings"
            title="Text settings"
          >
            <TypeIcon className="h-[18px] w-[18px]" />
          </button>
          {canFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className={iconBtn}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              title={fullscreen ? "Exit full screen" : "Full screen"}
            >
              {fullscreen ? <MinimizeIcon className="h-[17px] w-[17px]" /> : <MaximizeIcon className="h-[17px] w-[17px]" />}
            </button>
          )}
        </div>
        {sheet && (
          <div className="mx-auto max-h-[70dvh] max-w-md overflow-y-auto px-3 pb-3">
            {sheet === "settings" ? (
              <>
                <ReaderPanel value={reader} onChange={changeReader} canSpeak={canSpeak} canTranslate={aiEnabled || hasAnyLines} />
                <div className="reader-muted flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <a
                    href={book ? api.epubUrl("series", book.id) : api.epubUrl("story", story.id)}
                    download
                    className="underline"
                  >
                    Download {book ? "the book" : "this story"} as EPUB
                  </a>
                  <Link to={`/stories/${story.id}/edit`} className="underline">
                    Edit this story
                  </Link>
                </div>
              </>
            ) : (
              <Glossary entries={story.glossary} />
            )}
          </div>
        )}
        {translationsOn && tr.error && (
          <p className="mx-auto mb-2 max-w-md rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
            {tr.error}{" "}
            <button type="button" className="underline" onClick={tr.clearError}>
              Try again
            </button>
          </p>
        )}
      </div>

      {paged ? (
        <div
          ref={areaRef}
          className="absolute inset-x-0 bottom-10 top-14 flex justify-center"
          // Keep horizontal drags ours: otherwise the browser takes the gesture
          // (and cancels the pointer) before a swipe can turn the page.
          style={{ touchAction: "pan-y pinch-zoom" }}
          onPointerDown={(e) => {
            if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerCancel={() => {
            swipe.current = null;
          }}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s) return;
            const dx = e.clientX - s.x;
            const dy = e.clientY - s.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              swiped.current = true;
              turn(dx < 0 ? 1 : -1);
              window.setTimeout(() => (swiped.current = false), 80);
            }
          }}
          onClickCapture={(e) => {
            if (swiped.current) {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
          onClick={(e) => {
            // Taps beside the text column (the text handles its own).
            const t = e.target as HTMLElement;
            if (articleRef.current?.contains(t) || t.closest("a,button,input,textarea,select,label,[data-no-tap]")) return;
            tapAt(e.clientX);
          }}
        >
          <div className="h-full overflow-hidden" style={{ width: colWidth || "100%", visibility: atEnd ? "hidden" : undefined }}>
            <div
              ref={flowRef}
              className="reader-flow"
              style={{ ...typography, transform: `translateX(${-Math.min(page, pageCount - 1) * step}px)` }}
            >
              {text}
            </div>
          </div>
          {atEnd && (
            <div className="absolute inset-0 overflow-y-auto px-5">
              <div className="mx-auto pb-8 pt-2" style={{ maxWidth: WIDTH_PX[reader.width] }}>
                <p className="reader-muted mb-4 text-center font-sans text-sm" lang="en">
                  — End of {book ? `chapter ${book.chapter}` : "the story"} —
                </p>
                {ending}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div ref={scrollerRef} className="absolute inset-0 overflow-y-auto px-5 pb-16 pt-16">
          <div className="mx-auto" style={{ ...typography, maxWidth: WIDTHS[reader.width] }}>
            {text}
            <div className="mt-8">{ending}</div>
          </div>
        </div>
      )}

      {/* Where you are: page counter (pages) or a thin progress line (scroll). */}
      {paged ? (
        <div className="reader-muted pointer-events-none absolute inset-x-0 bottom-0 flex h-10 items-center justify-center gap-3 font-sans text-xs" lang="en">
          <span className="tabular-nums">{atEnd ? "End" : `${page + 1} / ${pageCount}`}</span>
          <span className="h-0.5 w-24 overflow-hidden rounded-full" style={{ background: "rgb(var(--r-rule))" }}>
            <span className="block h-full bg-brand" style={{ width: `${Math.round((Math.min(page + 1, pageCount) / pageCount) * 100)}%` }} />
          </span>
        </div>
      ) : null}

      {listeningHere ? (
        <div className="ws-dock absolute bottom-12 right-4 z-30 inline-flex max-w-[calc(100%-2rem)] items-center gap-1 px-2 py-1.5 font-sans text-sm font-medium text-ink" lang="en">
          {ls.phase === "preparing" || ls.phase === "error" ? (
            <span className={`px-2 ${ls.phase === "error" ? "text-danger" : "text-ink-muted"}`}>
              {ls.phase === "error"
                ? `Couldn't play: ${ls.error}`
                : audioProgressText(ls.progress)}
            </span>
          ) : (
            <>
              <button type="button" onClick={() => seekParagraph(Math.max(0, ls.paragraph - 1))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface-sunken" aria-label="Previous paragraph">
                <SkipBackIcon className="h-4 w-4" />
              </button>
              <button type="button" onClick={playFromView} className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface-sunken" aria-label={ls.phase === "playing" ? "Pause" : "Play"}>
                {ls.phase === "playing" ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => seekParagraph(ls.paragraph + 1)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface-sunken" aria-label="Next paragraph">
                <SkipForwardIcon className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => openPlayer()} className="inline-flex h-8 items-center gap-1 rounded-full px-2 font-mono text-xs tabular-nums text-ink-muted hover:bg-surface-sunken" aria-label="Open the player" title="Open the player">
                {clock(Math.max(0, ls.duration - ls.position))} left
                <ChevronUpIcon className="h-4 w-4" />
              </button>
            </>
          )}
          <button type="button" onClick={stop} className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface-sunken" aria-label="Stop listening">
            <CrossIcon className="h-4 w-4" />
          </button>
        </div>
      ) : (
        speaking !== null && (
          <button
            type="button"
            onClick={stop}
            className="ws-dock absolute bottom-12 right-4 z-30 inline-flex items-center gap-2 px-4 py-2 font-sans text-sm font-medium text-ink"
            lang="en"
          >
            <StopIcon className="h-4 w-4" />
            Stop reading
          </button>
        )
      )}
    </div>
  );
}

/** The paragraph at the top of page `p`: the first one that ends on it or later. */
function firstOnPage(ends: number[], p: number): number {
  const i = ends.findIndex((end) => end >= p);
  return i < 0 ? Math.max(0, ends.length - 1) : i;
}

function Glossary({ entries }: { entries: Story["glossary"] }) {
  return (
    <div className="reader-rule rounded-card border px-4 py-3 font-sans text-sm shadow-pop" style={{ background: "rgb(var(--r-bg))" }}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] opacity-70" lang="en">
        Glossary
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {entries.map((g) => (
          <div key={g.term} className="contents">
            <dt className="font-semibold">{g.term}</dt>
            <dd className="reader-muted" lang="en">
              {g.meaning}
            </dd>
          </div>
        ))}
      </dl>
    </div>
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
    <div className="ws-tabs ws-tabs--sm">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className="ws-tab"
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
  const label = "text-sm text-ink-muted";
  const stepBtn =
    "grid h-8 w-8 place-items-center rounded-control border border-line-control bg-surface text-ink transition-colors hover:bg-surface-sunken";
  return (
    <div className="mb-3 space-y-3.5 rounded-card border border-line bg-surface-raised p-4 text-ink shadow-pop">
      <div className={row}>
        <span className={label}>Layout</span>
        <Segmented
          value={value.layout}
          options={[
            { id: "pages", label: "Pages" },
            { id: "scroll", label: "Scroll" },
          ]}
          onChange={(layout) => onChange({ layout })}
        />
      </div>
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
          <button type="button" className={`${stepBtn} text-sm`} onClick={() => onChange({ size: Math.max(14, value.size - 1) })} aria-label="Smaller text">
            A−
          </button>
          <span className="w-12 text-center font-mono text-sm tabular-nums">{value.size}px</span>
          <button type="button" className={`${stepBtn} text-base`} onClick={() => onChange({ size: Math.min(30, value.size + 1) })} aria-label="Larger text">
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
          {THEMES.filter((t) => !(isEink() && t.id === "sepia")).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange({ theme: t.id })}
              title={t.label}
              aria-label={`${t.label} theme`}
              aria-pressed={value.theme === t.id}
              className={`h-8 w-8 rounded-full border border-line-control ${
                value.theme === t.id ? "outline outline-2 outline-offset-2 outline-focus" : ""
              }`}
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
          className="ws-switch-native h-4 w-4 accent-[var(--brand)]"
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
  onFinished,
}: {
  story: Story;
  onFinished: () => void;
}) {
  const quiz = useStoryQuiz(story, onFinished);

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">Fragen zum Text</h2>
        <span className="font-mono text-sm tabular-nums text-ink-muted">
          {quiz.answered}/{quiz.total}
        </span>
      </div>
      <TapToTranslate className="space-y-3">
        {story.questions.map((q, i) => (
          <div
            key={`${quiz.round}-${q.id}`}
            className={`${card} p-5 text-ink`}
          >
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Frage {i + 1}</p>
            <ExerciseItemView
              item={q}
              submit={(response) => quiz.answer(q, response)}
            />
          </div>
        ))}
      </TapToTranslate>
      {quiz.done && (
        <div className={`${card} mt-4 flex flex-wrap items-center gap-3 p-4 text-ink`}>
          <span className="font-semibold">
            {quiz.correct}/{quiz.total} richtig
          </span>
          <button
            type="button"
            onClick={quiz.retry}
            className={`${btn.secondary} ${btn.sm}`}
          >
            <RetryIcon className="h-4 w-4" />
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
