import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { generateCounts, type ExerciseItem, type ExerciseProgress, type ExerciseSet } from "@mdb/shared";
import { useExerciseRunner, useExerciseSet, useTutorChat } from "@mdb/client/react";
import { ExerciseItemView } from "../components/ExerciseItemView";
import { ArrowUpIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, CrossIcon, LanguagesIcon, LightbulbIcon, MoreIcon, RetryIcon, SparklesIcon, TrashIcon } from "../components/icons";
import { btn, card } from "../components/ui";
import { TapToTranslate } from "../components/TapToTranslate";
import { TutorMarkdown } from "../components/TutorMarkdown";
import { describeItem } from "@mdb/client";
import { useAutoAdvance } from "../lib/autoAdvance";
import { StarButton } from "../components/StarButton";

// Enter presses within this window of an answer resolving are treated as the
// tail of the submitting keystroke, not a request to advance. Comfortably above
// the sub-millisecond leak, well below human "read result, press again" timing.
const ADVANCE_GUARD_MS = 400;

export function ExercisePlayer() {
  const { id } = useParams();
  const loaded = useExerciseSet(id!);

  if (loaded.status === "loading") return <p className="text-ink-muted">Loading…</p>;
  if (loaded.status === "error")
    return (
      <div>
        <p className="text-danger">Exercise not found.</p>
        <Link to="/exercises" className="text-sm underline">
          <ChevronLeftIcon className="h-4 w-4" />
          Exercises
        </Link>
      </div>
    );

  return (
    <Runner set={loaded.set} extra={loaded.extra} initial={loaded.initial} />
  );
}

function Runner({
  set,
  extra,
  initial,
}: {
  set: ExerciseSet;
  extra: ExerciseItem[];
  initial: ExerciseProgress | null;
}) {
  const run = useExerciseRunner({ set, extra, initial });
  const { items, index, item, results, answered, lastCorrect, done, correctCount, answeredCount, next, goTo } = run;
  const title = set.title;
  // The numbered question navigator is collapsed by default (the score + bar
  // already summarise progress); clicking that summary expands it.
  const [navOpen, setNavOpen] = useState(false);
  const [autoAdvance] = useAutoAdvance();
  const cardRef = useRef<HTMLDivElement>(null);

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
      if (Date.now() - run.answeredAt.current < ADVANCE_GUARD_MS) return;
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

  // Move on after a right answer when that's on (Settings → Learning; by
  // default on phones only), with a short pause so the result registers.
  // Wrong answers wait: you may want to read the answer or ask the tutor.
  // Enter advances too (above).
  useEffect(() => {
    if (!answered || !autoAdvance || !lastCorrect) return;
    const t = setTimeout(() => next(), 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, autoAdvance, lastCorrect, index]);

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
        {run.assistantEnabled && (
          <div className="mb-4">
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={run.generate.run}
                disabled={run.generate.busy}
                className={`${btn.secondary} flex-1`}
              >
                {!run.generate.busy && <SparklesIcon className="h-4 w-4" />}
                {run.generate.busy ? "Generating…" : `Generate ${run.generate.count} more like these`}
              </button>
              <select
                value={run.generate.count}
                onChange={(e) => run.generate.setCount(Number(e.target.value))}
                disabled={run.generate.busy}
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
            {run.generate.error && (
              <p className="mt-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
                {run.generate.error}
              </p>
            )}
          </div>
        )}
        {run.extraCount > 0 && (
          <p className="mb-4 text-sm text-ink-muted">
            This set includes {run.extraCount} extra {run.extraCount === 1 ? "exercise" : "exercises"} generated for you.{" "}
            <button type="button" onClick={() => void run.removeExtras().catch(() => {})} className="font-medium text-brand-ink underline underline-offset-2">
              Remove {run.extraCount === 1 ? "it" : "them"}
            </button>
          </p>
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

  const priorResult = run.priorResult;
  const answeredEarlier = !answered && priorResult !== undefined;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-1 flex items-center justify-between gap-2 text-sm text-ink-muted">
        <div className="flex min-w-0 items-center gap-1">
          <Link to="/exercises" className="inline-flex min-w-0 items-center gap-1 hover:text-ink">
            <ChevronLeftIcon className="h-4 w-4 shrink-0" />
            <span className="truncate font-medium">{title}</span>
          </Link>
          <StarButton kind="exercise" id={set.id} title={title} />
        </div>
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
          prevResults={run.prevRun?.results}
          onJump={goTo}
        />
      )}

      <div
        ref={cardRef}
        className={`${card} relative p-6 font-content sm:p-7 ${run.isGenerated(item.id) ? "pr-12 sm:pr-12" : ""} ${
          answered ? (lastCorrect ? "animate-correct" : "animate-wrong") : ""
        }`}
      >
        {run.isGenerated(item.id) && <GeneratedItemMenu key={item.id} onRemove={() => run.removeItem(item.id)} />}
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
            submit={run.submit}
          />
        </TapToTranslate>
      </div>

      {run.assistantEnabled && (
        <TutorHelp
          key={item.id}
          item={item}
          answered={answered}
          lastCorrect={lastCorrect}
          lastResponse={run.lastResponse}
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
            {run.isLast ? "Finish" : "Next"}
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

/**
 * A quiet "⋯" in the corner of an exercise generated for this learner, with
 * the one thing to do about it: remove it from the set.
 */
function GeneratedItemMenu({ onRemove }: { onRemove: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="absolute right-3 top-3 font-sans">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="More about this exercise"
        className="grid h-8 w-8 place-items-center rounded-full text-ink-subtle hover:bg-surface-sunken hover:text-ink"
      >
        <MoreIcon className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className={`${card} absolute right-0 top-9 z-10 w-60 p-1.5 shadow-lg`}>
          <p className="px-3 pb-1 pt-1.5 text-xs text-ink-subtle">Generated for you by the tutor.</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setError(null);
              onRemove().catch((e) => setError(e instanceof Error ? e.message : String(e)));
            }}
            className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft"
          >
            <TrashIcon className="h-4 w-4" />
            Remove this exercise
          </button>
          {error && <p className="px-3 py-1.5 text-xs text-danger">Couldn't remove it: {error}</p>}
        </div>
      )}
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

const chipCls =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink aria-pressed:border-transparent aria-pressed:bg-brand-soft aria-pressed:text-brand-ink";

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
  const tutor = useTutorChat({ item: describeItem(item), response: lastResponse });
  const { shot, chat } = tutor;
  const showWhyWrong = answered && !lastCorrect && lastResponse !== undefined;
  const title = chat ? "Why it was wrong" : shot?.kind === "hint" ? "Hint" : "Translation";

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={tutor.hint} className={chipCls} aria-pressed={shot?.kind === "hint"}>
          <LightbulbIcon className="h-3.5 w-3.5" />
          Hint
        </button>
        <button type="button" onClick={tutor.translate} className={chipCls} aria-pressed={shot?.kind === "translate"}>
          <LanguagesIcon className="h-3.5 w-3.5" />
          Translate
        </button>
        {showWhyWrong && (
          <button type="button" onClick={tutor.whyWrong} className={chipCls} aria-pressed={chat !== null}>
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
              onClick={tutor.close}
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
                  tutor.send();
                }}
                className="border-t border-line p-2"
              >
                <div className="flex items-center gap-2 rounded-full border border-line-control bg-surface-sunken py-1 pl-4 pr-1 transition-colors focus-within:border-focus focus-within:bg-surface">
                  <input
                    value={chat.input}
                    onChange={(e) => tutor.setInput(e.target.value)}
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
