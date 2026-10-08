import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import {
  generateCounts,
  type AnswerGrading,
  type ExerciseItem,
  type ExerciseProgress,
  type ExerciseRun,
  type ExerciseSet,
} from "@mdb/shared";
import { ExerciseItemView } from "../components/ExerciseItemView";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrossIcon,
  LanguagesIcon,
  LightbulbIcon,
  ArrowUpIcon,
  RetryIcon,
  SparklesIcon,
} from "../components/icons";
import { btn, card } from "../components/ui";
import { TapToTranslate } from "../components/TapToTranslate";
import { TutorMarkdown } from "../components/TutorMarkdown";
import { api, askAssistant, type ChatTurn } from "../lib/api";
import { describeItem } from "../lib/describeItem";
import { useAsync } from "../lib/useAsync";

// Enter presses within this window of an answer resolving are treated as the
// tail of the submitting keystroke, not a request to advance. Comfortably above
// the sub-millisecond leak, well below human "read result, press again" timing.
const ADVANCE_GUARD_MS = 400;

export function ExercisePlayer() {
  const { id } = useParams();
  const set = useAsync(() => api.exercise(id!), [id]);
  // Resume where the learner left off (null if none / on error).
  const progress = useAsync(() => api.exerciseProgress(id!).catch(() => null), [id]);

  if (set.status === "loading" || progress.status === "loading")
    return <p className="text-slate-500">Loading…</p>;
  if (set.status === "error")
    return (
      <div>
        <p className="text-red-600">Exercise not found.</p>
        <Link to="/exercises" className="text-sm underline">
          ← Exercises
        </Link>
      </div>
    );

  return (
    <Runner
      set={set.data}
      initial={progress.status === "ready" ? progress.data : null}
    />
  );
}

function Runner({
  set,
  initial,
}: {
  set: ExerciseSet;
  initial: ExerciseProgress | null;
}) {
  const setId = set.id;
  const title = set.title;
  const [items, setItems] = useState<ExerciseItem[]>(set.items);
  const [index, setIndex] = useState(() =>
    initial ? Math.min(Math.max(0, initial.index), set.items.length - 1) : 0,
  );
  // Per-item correctness / responses for THIS run, keyed by item id. Drives the
  // live score, the question navigator, and the run recorded at the end.
  const [results, setResults] = useState<Record<string, boolean>>(() => {
    if (!initial) return {};
    const ids = new Set(set.items.map((i) => i.id));
    return Object.fromEntries(
      Object.entries(initial.results).filter(([k]) => ids.has(k)),
    );
  });
  const [responses, setResponses] = useState<Record<string, string | undefined>>(
    () => (initial ? { ...initial.responses } : {}),
  );
  // Whether the current *visit* of the current item has been answered. Resets on
  // navigation so revisiting an item re-opens it for another attempt.
  const [answered, setAnswered] = useState(false);
  const [lastCorrect, setLastCorrect] = useState(false);
  const [lastResponse, setLastResponse] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const [prevRun, setPrevRun] = useState<ExerciseRun | null>(null);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [llmGrading, setLlmGrading] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genCount, setGenCount] = useState(5);
  // The numbered question navigator is collapsed by default (the score + bar
  // already summarise progress); clicking that summary expands it.
  const [navOpen, setNavOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches,
  );
  // When set, records the moment the current item was resolved. Used to ignore
  // the tail of the Enter keystroke that submitted the answer (see below).
  const answeredAt = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const correctCount = useMemo(
    () => Object.values(results).filter(Boolean).length,
    [results],
  );
  const answeredCount = Object.keys(results).length;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    // The tutor powers the Hint / Why-wrong buttons; llmGrading additionally
    // gates AI grading of free-text answers.
    Promise.all([api.assistantStatus(), api.settings()])
      .then(([st, se]) => {
        setAssistantEnabled(st.enabled);
        setLlmGrading(Boolean(st.enabled && se.llmGrading));
        setGenCount(se.generateCount);
      })
      .catch(() => {});
  }, []);

  // The previous run's per-item results — shown as faint hints in the navigator.
  useEffect(() => {
    api
      .run(setId)
      .then(setPrevRun)
      .catch(() => {});
  }, [setId]);

  const item = items[index]!;

  // Persist the run once (and again if it grew, e.g. after "generate more"), so
  // the last score survives a reload and feeds the exercise cards + dashboard.
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const savedCountRef = useRef(0);
  function saveRun() {
    const entries = Object.entries(resultsRef.current);
    if (entries.length === 0 || entries.length <= savedCountRef.current) return;
    savedCountRef.current = entries.length;
    void api
      .recordRun({
        setId,
        setTitle: title,
        total: items.length,
        answered: entries.length,
        correct: entries.filter(([, ok]) => ok).length,
        results: resultsRef.current,
      })
      .catch(() => {});
  }
  // Save on leave (route change unmounts this component).
  useEffect(() => () => saveRun(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist the resume point (position + answers so far), restricted to the
  // base set so ephemeral "generate more" items never end up saved.
  function saveProgress(
    i: number,
    res: Record<string, boolean>,
    resp: Record<string, string | undefined>,
  ) {
    const ids = new Set(set.items.map((x) => x.id));
    const results = Object.fromEntries(
      Object.entries(res).filter(([k]) => ids.has(k)),
    );
    const responses: Record<string, string> = {};
    for (const [k, v] of Object.entries(resp)) {
      if (typeof v === "string" && ids.has(k)) responses[k] = v;
    }
    const position = Math.min(Math.max(0, i), set.items.length - 1);
    void api
      .saveExerciseProgress(setId, { index: position, results, responses })
      .catch(() => {});
  }

  function handleAnswered(correct: boolean, response?: string, grading: AnswerGrading = "auto") {
    if (answered) return;
    answeredAt.current = performance.now();
    setAnswered(true);
    setLastCorrect(correct);
    setLastResponse(response);
    const nextResults = { ...results, [item.id]: correct };
    const nextResponses = { ...responses, [item.id]: response };
    setResults(nextResults);
    setResponses(nextResponses);
    // Fire-and-forget; a failed save shouldn't block practice.
    void api
      .recordAttempt({ setId, itemId: item.id, correct, response, grading })
      .catch(() => {});
    saveProgress(index, nextResults, nextResponses);
  }

  function goTo(i: number) {
    if (i < 0 || i >= items.length) return;
    setIndex(i);
    setAnswered(false);
    setLastResponse(undefined);
    saveProgress(i, results, responses);
  }

  function next() {
    if (index + 1 >= items.length) {
      saveRun();
      void api.clearExerciseProgress(setId).catch(() => {});
      setDone(true);
    } else {
      goTo(index + 1);
    }
  }

  async function generateMore() {
    setGenBusy(true);
    setGenError(null);
    const startAt = items.length;
    try {
      const res = await api.generateMore({
        count: genCount,
        set: {
          title: set.title,
          level: set.level,
          tags: set.tags,
          types: [...new Set(set.items.map((i) => i.type))],
          samples: set.items.slice(0, 3),
        },
      });
      if (res.items.length === 0) {
        setGenError(
          res.received > 0
            ? `The tutor returned ${res.received} item${res.received === 1 ? "" : "s"} but ${res.received === 1 ? "it wasn't" : "none were"} valid — try again.`
            : "The tutor didn't return any exercises — try again.",
        );
        return;
      }
      setItems((cur) => [...cur, ...res.items]);
      setIndex(startAt);
      setAnswered(false);
      setLastResponse(undefined);
      setDone(false);
    } catch (e) {
      setGenError(
        `Couldn't reach the tutor: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setGenBusy(false);
    }
  }

  // Once an item is resolved, Enter advances — unless you're typing in a live
  // field (e.g. the tutor chat) or a button is focused (it handles Enter itself).
  useEffect(() => {
    if (!answered) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      // A free-text item is submitted with Enter; grading is async, so this
      // listener mounts a beat later and would otherwise catch the tail of that
      // very keystroke and skip the item instantly. Ignore Enters that land
      // right after the answer resolves — a deliberate "next" press comes later.
      if (performance.now() - answeredAt.current < ADVANCE_GUARD_MS) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const typing =
        (tag === "INPUT" || tag === "TEXTAREA") &&
        !(el as HTMLInputElement | null)?.disabled;
      if (typing || tag === "BUTTON") return;
      e.preventDefault();
      next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, index, items.length]);

  // On mobile, auto-advance after a correct answer (with a short pause so the
  // result registers). Wrong answers wait — you may want to read the answer or
  // ask the tutor. On desktop, Enter advances (above); nothing is automatic.
  useEffect(() => {
    if (!answered || !mobile || !lastCorrect) return;
    const t = setTimeout(() => next(), 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, mobile, lastCorrect, index]);

  // When a new item is shown, focus its first text field so keyboard users can
  // keep typing after advancing (no-op for choice/flashcard items).
  useEffect(() => {
    cardRef.current
      ?.querySelector<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled])",
      )
      ?.focus();
  }, [item.id, index]);

  if (done) {
    return (
      <div className={`${card} mx-auto max-w-md px-6 py-10 text-center`}>
        <div
          role="img"
          aria-label={`${correctCount} of ${answeredCount} correct`}
          className="mx-auto mb-5 grid h-24 w-24 place-items-center rounded-full"
          style={{
            background: `conic-gradient(from -90deg, var(--reward-1), var(--reward-2), var(--reward-3) ${answeredCount ? Math.round((correctCount / answeredCount) * 100) : 0}%, var(--surface-sunken) 0)`,
          }}
        >
          <span className="grid h-[78px] w-[78px] place-items-center rounded-full bg-surface font-mono text-base font-medium tabular-nums">
            {correctCount}/{answeredCount}
          </span>
        </div>
        <h1 className="mb-1 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">Set finished</h1>
        <p className="mb-1 text-ink-muted">
          {correctCount} of {answeredCount} correct
        </p>
        <p className="mb-6 text-sm text-ink-subtle">
          {answeredCount === items.length
            ? "Whole set completed."
            : `${answeredCount} of ${items.length} questions answered.`}
        </p>
        {assistantEnabled && (
          <div className="mb-4">
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={generateMore}
                disabled={genBusy}
                className={`${btn.secondary} flex-1`}
              >
                {!genBusy && <SparklesIcon className="h-4 w-4" />}
                {genBusy ? "Generating…" : `Generate ${genCount} more like these`}
              </button>
              <select
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value))}
                disabled={genBusy}
                aria-label="How many exercises to generate"
                className="rounded-control border border-line-control bg-surface-sunken px-2 text-sm font-medium tabular-nums text-ink outline-none focus:border-focus disabled:opacity-50"
              >
                {generateCounts.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            {genError && (
              <p className="mt-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
                {genError}
              </p>
            )}
          </div>
        )}
        <Link
          to="/exercises"
          className={btn.primary}
        >
          Back to practice
        </Link>
      </div>
    );
  }

  const priorResult = results[item.id];
  const answeredEarlier = !answered && priorResult !== undefined;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-1 flex items-center justify-between gap-2 text-sm text-ink-muted">
        <Link to="/exercises" className="inline-flex min-w-0 items-center gap-1 hover:text-ink">
          <ChevronLeftIcon className="h-4 w-4 shrink-0" />
          <span className="truncate font-medium">{title}</span>
        </Link>
        <button
          type="button"
          onClick={() => setNavOpen((o) => !o)}
          aria-expanded={navOpen}
          aria-label={navOpen ? "Hide question navigator" : "Show question navigator"}
          className="flex shrink-0 items-center gap-2 rounded-chip px-1 hover:text-ink"
        >
          <ScoreChips correct={correctCount} wrong={answeredCount - correctCount} />
          <span className="tabular-nums">
            {index + 1} / {items.length}
          </span>
          <Chevron open={navOpen} />
        </button>
      </div>
      {set.subtitle && (
        <p className="mb-3 text-sm text-ink-subtle">{set.subtitle}</p>
      )}
      <button
        type="button"
        onClick={() => setNavOpen((o) => !o)}
        aria-hidden
        tabIndex={-1}
        className="mb-4 block h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        <span
          className="block h-full rounded-full bg-[linear-gradient(90deg,var(--reward-1),var(--reward-2),var(--reward-3))] transition-all"
          style={{ width: `${(answeredCount / items.length) * 100}%` }}
        />
      </button>

      {navOpen && (
        <QuestionNav
          items={items}
          index={index}
          results={results}
          prevResults={prevRun?.results}
          onJump={goTo}
        />
      )}

      <div
        ref={cardRef}
        className={`${card} p-6 font-content sm:p-7 ${
          answered ? (lastCorrect ? "animate-correct" : "animate-wrong") : ""
        }`}
      >
        {answeredEarlier && (
          <p className="mb-5 flex items-center gap-2 text-xs text-ink-muted">
            <RetryIcon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
            You answered this{" "}
            <span
              className={priorResult ? "font-medium text-success" : "font-medium text-danger"}
            >
              {priorResult ? "correctly" : "incorrectly"}
            </span>{" "}
            this run — answer again to change it.
          </p>
        )}
        <TapToTranslate>
          <ExerciseItemView
            key={item.id}
            item={item}
            onAnswered={handleAnswered}
            llmGrading={llmGrading}
          />
        </TapToTranslate>
      </div>

      {assistantEnabled && (
        <TutorHelp
          key={item.id}
          item={item}
          answered={answered}
          lastCorrect={lastCorrect}
          lastResponse={lastResponse}
        />
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          className={btn.secondary}
          aria-label="Previous question"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Prev
        </button>
        {answered ? (
          <button
            type="button"
            onClick={next}
            className={`${btn.primary} flex-1`}
          >
            {index + 1 >= items.length ? "Finish" : "Next"}
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={index + 1 >= items.length}
            className={`${btn.ghost} flex-1`}
          >
            Skip
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Small disclosure chevron that points down when closed, up when open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Live ✓ / ✗ tally for the current run. */
function ScoreChips({ correct, wrong }: { correct: number; wrong: number }) {
  if (correct + wrong === 0) return null;
  return (
    <span className="flex items-center gap-1.5 tabular-nums">
      <span className="inline-flex items-center gap-0.5 text-success"><CheckIcon className="h-3.5 w-3.5" />{correct}</span>
      <span className="inline-flex items-center gap-0.5 text-danger"><CrossIcon className="h-3.5 w-3.5" />{wrong}</span>
    </span>
  );
}

/**
 * Jump-to-question strip. Each cell is filled with this run's result once
 * answered, otherwise tinted by the previous run's result for that question.
 */
function QuestionNav({
  items,
  index,
  results,
  prevResults,
  onJump,
}: {
  items: ExerciseItem[];
  index: number;
  results: Record<string, boolean>;
  prevResults?: Record<string, boolean>;
  onJump: (i: number) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {items.map((it, i) => {
        const mine = results[it.id];
        const prev = prevResults?.[it.id];
        const current = i === index;
        let cls: string;
        if (mine !== undefined) {
          cls = mine
            ? "border-transparent bg-success-soft text-success font-semibold"
            : "border-transparent bg-danger-soft text-danger font-semibold";
        } else if (prev !== undefined) {
          cls = prev
            ? "border-dashed border-current text-success"
            : "border-dashed border-current text-danger";
        } else {
          cls = "border-line bg-surface text-ink-muted";
        }
        const prevNote =
          prev !== undefined ? ` · last run: ${prev ? "correct" : "wrong"}` : "";
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onJump(i)}
            title={`Question ${i + 1}${prevNote}`}
            aria-label={`Go to question ${i + 1}${prevNote}`}
            className={`grid h-8 w-8 place-items-center rounded-chip border text-xs tabular-nums ${cls} ${
              current ? "outline outline-2 outline-offset-1 outline-focus" : ""
            }`}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const chipCls =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink aria-pressed:border-transparent aria-pressed:bg-brand-soft aria-pressed:text-brand-ink";

type OneShot = { kind: "hint" | "translate"; text: string; busy: boolean; error?: string };
type Chat = { msgs: ChatTurn[]; input: string; busy: boolean; error?: string };

/** Inline AI help: no-spoiler Hint, Translate, and a chat when you got it wrong. */
function TutorHelp({
  item,
  answered,
  lastCorrect,
  lastResponse,
}: {
  item: ExerciseItem;
  answered: boolean;
  lastCorrect: boolean;
  lastResponse?: string;
}) {
  const [shot, setShot] = useState<OneShot | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const showWhyWrong = answered && !lastCorrect && lastResponse !== undefined;
  const desc = describeItem(item);

  function fresh() {
    abortRef.current?.abort();
    const c = new AbortController();
    abortRef.current = c;
    return c;
  }

  function appendLast(msgs: ChatTurn[], t: string): ChatTurn[] {
    const copy = msgs.slice();
    const last = copy[copy.length - 1];
    if (last) copy[copy.length - 1] = { ...last, content: last.content + t };
    return copy;
  }

  function runShot(kind: "hint" | "translate") {
    const c = fresh();
    setChat(null);
    setShot({ kind, text: "", busy: true });
    askAssistant(
      { task: kind === "hint" ? "hint" : "translate_exercise", item: desc },
      (t) => setShot((s) => (s ? { ...s, text: s.text + t } : s)),
      c.signal,
    )
      .catch((e) => {
        if (!c.signal.aborted)
          setShot((s) => (s ? { ...s, error: msgOf(e), busy: false } : s));
      })
      .finally(() => setShot((s) => (s ? { ...s, busy: false } : s)));
  }

  function startWhyWrong() {
    const c = fresh();
    setShot(null);
    setChat({ msgs: [{ role: "assistant", content: "" }], input: "", busy: true });
    askAssistant(
      { task: "why_wrong", item: desc, response: lastResponse },
      (t) => setChat((s) => (s ? { ...s, msgs: appendLast(s.msgs, t) } : s)),
      c.signal,
    )
      .catch((e) => {
        if (!c.signal.aborted)
          setChat((s) => (s ? { ...s, error: msgOf(e), busy: false } : s));
      })
      .finally(() => setChat((s) => (s ? { ...s, busy: false } : s)));
  }

  function sendFollowup() {
    if (!chat || !chat.input.trim() || chat.busy) return;
    const history: ChatTurn[] = [
      ...chat.msgs,
      { role: "user", content: chat.input.trim() },
    ];
    const c = fresh();
    setChat({
      msgs: [...history, { role: "assistant", content: "" }],
      input: "",
      busy: true,
    });
    askAssistant(
      { task: "chat", item: desc, response: lastResponse, history },
      (t) => setChat((s) => (s ? { ...s, msgs: appendLast(s.msgs, t) } : s)),
      c.signal,
    )
      .catch((e) => {
        if (!c.signal.aborted)
          setChat((s) => (s ? { ...s, error: msgOf(e), busy: false } : s));
      })
      .finally(() => setChat((s) => (s ? { ...s, busy: false } : s)));
  }

  const title = chat ? "Why it was wrong" : shot?.kind === "hint" ? "Hint" : "Translation";
  const close = () => {
    abortRef.current?.abort();
    setShot(null);
    setChat(null);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => runShot("hint")} className={chipCls} aria-pressed={shot?.kind === "hint"}>
          <LightbulbIcon className="h-3.5 w-3.5" />
          Hint
        </button>
        <button type="button" onClick={() => runShot("translate")} className={chipCls} aria-pressed={shot?.kind === "translate"}>
          <LanguagesIcon className="h-3.5 w-3.5" />
          Translate
        </button>
        {showWhyWrong && (
          <button type="button" onClick={startWhyWrong} className={chipCls} aria-pressed={chat !== null}>
            <SparklesIcon className="h-3.5 w-3.5" />
            Why was I wrong?
          </button>
        )}
      </div>

      {(shot || chat) && (
        <section
          aria-label={`Tutor: ${title}`}
          className="mt-3 overflow-hidden rounded-card border border-line bg-surface-raised shadow-card"
        >
          <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="ws-glass-icon grid h-6 w-6 place-items-center rounded-full" style={{ "--tint": "var(--brand)" } as CSSProperties}>
              <SparklesIcon className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-semibold">Tutor</span>
            <span className="text-sm text-ink-subtle">· {title}</span>
            <button
              type="button"
              onClick={close}
              aria-label="Close tutor"
              className="ml-auto grid h-7 w-7 place-items-center rounded-chip text-ink-subtle hover:bg-surface-sunken hover:text-ink"
            >
              <CrossIcon className="h-4 w-4" />
            </button>
          </header>

          {shot && (
            <div className="px-4 py-3">
              {shot.error ? <p className="text-sm text-danger">{shot.error}</p> : <TutorMarkdown text={shot.text} busy={shot.busy} />}
            </div>
          )}

          {chat && (
            <>
              <div className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto px-4 py-3">
                {chat.msgs.map((m, i) =>
                  m.role === "assistant" ? (
                    <TutorMarkdown key={i} text={m.content} busy={chat.busy && i === chat.msgs.length - 1} />
                  ) : (
                    <div key={i} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-brand-soft px-3.5 py-2 text-sm text-ink">
                      {m.content}
                    </div>
                  ),
                )}
                {chat.error && <p className="text-sm text-danger">{chat.error}</p>}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendFollowup();
                }}
                className="border-t border-line p-2"
              >
                <div className="flex items-center gap-2 rounded-full border border-line-control bg-surface-sunken py-1 pl-4 pr-1 transition-colors focus-within:border-focus focus-within:bg-surface">
                  <input
                    value={chat.input}
                    onChange={(e) => setChat((s) => (s ? { ...s, input: e.target.value } : s))}
                    placeholder="Ask a follow-up…"
                    aria-label="Ask the tutor a follow-up question"
                    className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-subtle"
                  />
                  <button
                    type="submit"
                    disabled={chat.busy || !chat.input.trim()}
                    aria-label="Send"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-brand-on disabled:opacity-40"
                  >
                    <ArrowUpIcon className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      )}
    </div>
  );
}
