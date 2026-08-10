import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  generateCounts,
  type ExerciseItem,
  type ExerciseProgress,
  type ExerciseRun,
  type ExerciseSet,
} from "@mdb/shared";
import { ExerciseItemView } from "../components/ExerciseItemView";
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

  function handleAnswered(correct: boolean, response?: string) {
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
    void api.recordAttempt(setId, item.id, correct).catch(() => {});
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
      <div className="mx-auto max-w-md text-center">
        <h1 className="mb-2 text-2xl font-bold">Done! 🎉</h1>
        <p className="mb-1 text-slate-500">
          {correctCount} / {answeredCount} correct
        </p>
        <p className="mb-6 text-xs text-slate-400">
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
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 font-medium hover:border-slate-500 disabled:opacity-50 dark:border-slate-700"
              >
                {genBusy ? "Generating…" : `✨ Generate ${genCount} more like these`}
              </button>
              <select
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value))}
                disabled={genBusy}
                aria-label="How many exercises to generate"
                className="rounded-lg border border-slate-300 bg-transparent px-2 py-2 font-medium tabular-nums outline-none focus:border-slate-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
              >
                {generateCounts.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            {genError && (
              <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {genError}
              </p>
            )}
          </div>
        )}
        <Link
          to="/exercises"
          className="inline-block rounded-lg bg-accent px-4 py-2 text-accent-foreground"
        >
          Back to exercises
        </Link>
      </div>
    );
  }

  const priorResult = results[item.id];
  const answeredEarlier = !answered && priorResult !== undefined;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-1 flex items-center justify-between gap-2 text-sm text-slate-500">
        <Link to="/exercises" className="hover:underline">
          ← {title}
        </Link>
        <button
          type="button"
          onClick={() => setNavOpen((o) => !o)}
          aria-expanded={navOpen}
          aria-label={navOpen ? "Hide question navigator" : "Show question navigator"}
          className="flex shrink-0 items-center gap-2 rounded hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ScoreChips correct={correctCount} wrong={answeredCount - correctCount} />
          <span className="tabular-nums">
            {index + 1} / {items.length}
          </span>
          <Chevron open={navOpen} />
        </button>
      </div>
      {set.subtitle && (
        <p className="mb-3 text-xs text-slate-400">{set.subtitle}</p>
      )}
      <button
        type="button"
        onClick={() => setNavOpen((o) => !o)}
        aria-hidden
        tabIndex={-1}
        className="mb-3 block h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-800"
      >
        <span
          className="block h-full bg-accent transition-all"
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
        className={`rounded-xl border border-slate-200 bg-white p-6 font-content dark:border-slate-800 dark:bg-slate-900 ${
          answered ? (lastCorrect ? "animate-correct" : "animate-wrong") : ""
        }`}
      >
        {answeredEarlier && (
          <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            You answered this{" "}
            <span
              className={priorResult ? "text-green-600" : "text-red-600"}
            >
              {priorResult ? "correctly ✓" : "incorrectly ✗"}
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
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:border-slate-500 disabled:opacity-40 dark:border-slate-700"
        >
          ← Prev
        </button>
        {answered ? (
          <button
            type="button"
            onClick={next}
            className="flex-1 rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground"
          >
            {index + 1 >= items.length ? "Finish" : "Next"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={index + 1 >= items.length}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2 font-medium hover:border-slate-500 disabled:opacity-40 dark:border-slate-700"
          >
            Skip →
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
      <span className="text-green-600">✓ {correct}</span>
      <span className="text-red-500">✗ {wrong}</span>
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
            ? "bg-green-500 text-white border-green-500"
            : "bg-red-500 text-white border-red-500";
        } else if (prev !== undefined) {
          cls = prev
            ? "border-green-400 text-green-600 dark:text-green-400"
            : "border-red-400 text-red-600 dark:text-red-400";
        } else {
          cls = "border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400";
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
            className={`grid h-7 w-7 place-items-center rounded-md border text-xs tabular-nums ${cls} ${
              current ? "ring-2 ring-accent ring-offset-1 ring-offset-white dark:ring-offset-slate-950" : ""
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
  "rounded-full border border-slate-300 px-3 py-1 text-xs hover:border-slate-500 dark:border-slate-700";

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

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => runShot("hint")} className={chipCls}>
          💡 Hint
        </button>
        <button type="button" onClick={() => runShot("translate")} className={chipCls}>
          🌐 Translate
        </button>
        {showWhyWrong && (
          <button type="button" onClick={startWhyWrong} className={chipCls}>
            Why was I wrong?
          </button>
        )}
      </div>

      {shot && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
          {shot.error ? (
            <span className="text-sm text-red-600">{shot.error}</span>
          ) : (
            <TutorMarkdown text={shot.text} busy={shot.busy} />
          )}
        </div>
      )}

      {chat && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
          {chat.msgs.map((m, i) =>
            m.role === "assistant" ? (
              <TutorMarkdown
                key={i}
                text={m.content}
                busy={chat.busy && i === chat.msgs.length - 1}
              />
            ) : (
              <div
                key={i}
                className="max-w-[85%] self-end rounded-lg bg-slate-200 px-3 py-1.5 text-sm dark:bg-slate-700"
              >
                {m.content}
              </div>
            ),
          )}
          {chat.error && <p className="text-sm text-red-600">{chat.error}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendFollowup();
            }}
            className="flex gap-2 pt-1"
          >
            <input
              value={chat.input}
              onChange={(e) =>
                setChat((s) => (s ? { ...s, input: e.target.value } : s))
              }
              placeholder="Ask a follow-up…"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-slate-700"
            />
            <button
              type="submit"
              disabled={chat.busy || !chat.input.trim()}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
