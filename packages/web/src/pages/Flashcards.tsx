import { useEffect, useMemo, useState } from "react";
import { filterVocab, useFlashcards } from "@mdb/client/react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { SpeakButton } from "../components/SpeakButton";
import { formChips } from "../lib/forms";
import { useVocab } from "../lib/vocab";
import { CheckIcon, ChevronLeftIcon, CrossIcon, RetryIcon } from "../components/icons";
import { btn, card } from "../components/ui";

type Dir = "de" | "en";
const DIR_KEY = "mdb-flashcard-dir";

export function Flashcards() {
  const { entries, groups, recordStudy } = useVocab();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const groupParam = params.get("group") ?? "all";
  const groupId = groupParam === "all" ? null : Number(groupParam);
  const groupName =
    groupId == null
      ? "All words"
      : groups.find((g) => g.id === groupId)?.name ?? "Group";

  const pool = useMemo(() => filterVocab(entries, { group: groupId }), [entries, groupId]);

  const [dir, setDir] = useState<Dir>(() => {
    try {
      return (localStorage.getItem(DIR_KEY) as Dir) || "de";
    } catch {
      return "de";
    }
  });
  const session = useFlashcards(pool, recordStudy);
  const { phase, queue, index: i, card: word, flipped, setFlipped, start, grade } = session;

  function toggleDir() {
    setDir((d) => {
      const next = d === "de" ? "en" : "de";
      try {
        localStorage.setItem(DIR_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
    setFlipped(false);
  }

  // Keyboard: Space/Enter flip, ← don't know, → know.
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowLeft") {
        grade(false);
      } else if (e.key === "ArrowRight") {
        grade(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, i, queue, flipped]);

  const back = (
    <Link to="/vocab" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
      <ChevronLeftIcon className="h-4 w-4" />
      Vocab
    </Link>
  );

  if (phase === "loading") {
    return (
      <div className="space-y-4">
        {back}
        {entries.length > 0 && pool.length === 0 ? (
          <p className="rounded-card border border-dashed border-line-control p-6 text-center text-sm text-ink-muted">
            No words in “{groupName}” yet. Add some, then come back to study.
          </p>
        ) : (
          <p className="text-ink-muted">Loading…</p>
        )}
      </div>
    );
  }

  if (phase === "done") {
    const total = queue.length;
    const { knownCount, missed, percent: pct } = session;
    return (
      <div className="mx-auto max-w-md space-y-5">
        {back}
        <div className={`${card} px-6 py-8 text-center`}>
          <div
            role="img"
            aria-label={`${pct} percent known`}
            className="mx-auto mb-4 grid h-24 w-24 place-items-center rounded-full"
            style={{ background: `conic-gradient(from -90deg, var(--reward-1), var(--reward-2), var(--reward-3) ${pct}%, var(--surface-sunken) 0)` }}
          >
            <span className="grid h-[78px] w-[78px] place-items-center rounded-full bg-surface font-mono text-base font-medium tabular-nums">{pct}%</span>
          </div>
          <p className="text-ink-muted">
            You knew <span className="font-semibold text-ink">{knownCount}</span> of {total} in “{groupName}”.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            {missed.length > 0 && (
              <button
                type="button"
                onClick={() => start(missed)}
                className={btn.primary}
              >
                <RetryIcon className="h-4 w-4" />
                Review the {missed.length} you missed
              </button>
            )}
            <button
              type="button"
              onClick={() => start(pool)}
              className={btn.secondary}
            >
              Study all {pool.length} again
            </button>
            <button
              type="button"
              onClick={() => navigate("/vocab")}
              className={btn.ghost}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // playing
  if (!word) return null;
  const knownSoFar = session.knownCount;
  const missedSoFar = session.missedCount;
  const promptText = dir === "de" ? word.display : word.translation;
  const answerText = dir === "de" ? word.translation : word.display;

  return (
    <div className="mx-auto max-w-md">
      <div className="flex items-center justify-between gap-2">
        {back}
        <button
          type="button"
          onClick={toggleDir}
          className={`${btn.secondary} ${btn.sm} font-mono`}
          title="Switch which side is shown first"
        >
          {dir === "de" ? "DE → EN" : "EN → DE"}
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs font-medium text-ink-subtle">
        <span>{groupName}</span>
        <span>
          {i + 1} / {queue.length}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--reward-1),var(--reward-2),var(--reward-3))] transition-all"
          style={{ width: `${((i + (flipped ? 0.5 : 0)) / queue.length) * 100}%` }}
        />
      </div>

      <button
        type="button"
        onClick={() => setFlipped(true)}
        className="mt-4 flex min-h-[17rem] w-full cursor-pointer flex-col rounded-panel border border-line bg-surface p-7 text-left shadow-card-hover"
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          {dir === "de" ? "German" : "English"}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-content text-[34px] font-semibold leading-10 tracking-[-0.02em]">{promptText}</span>
          {dir === "de" && <SpeakButton text={word.display} />}
        </div>

        {flipped ? (
          <div className="mt-5 border-t border-line pt-4 font-content">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {dir === "de" ? "English" : "German"}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xl text-ink">{answerText}</span>
              {dir === "en" && <SpeakButton text={word.display} />}
            </div>
            {formChips(word.forms).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {formChips(word.forms).map(([label, val]) => (
                  <span
                    key={label}
                    className="rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-xs"
                  >
                    <span className="text-ink-subtle">{label}:</span>{" "}
                    <span className="font-medium">{val}</span>
                  </span>
                ))}
              </div>
            )}
            {word.examples.length > 0 && (
              <div className="mt-3 space-y-2">
                {word.examples.slice(0, 2).map((ex, k) => (
                  <div key={k} className="rounded-control bg-surface-sunken p-2.5 text-sm">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-ink">{ex.de}</p>
                      <SpeakButton text={ex.de} className="-mr-1 -mt-1" />
                    </div>
                    <p className="text-ink-muted">{ex.en}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-auto pt-6 text-sm text-ink-subtle">
            Tap to reveal · <span className="hidden sm:inline">Space</span>
          </div>
        )}
      </button>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => grade(false)}
          className={`${btn.secondary} h-12`}
        >
          <CrossIcon className="h-4 w-4 text-danger" />
          Don’t know
          <kbd className="ml-1 hidden rounded-chip border border-line bg-surface-sunken px-1.5 font-mono text-[11px] text-ink-subtle sm:inline">←</kbd>
        </button>
        <button
          type="button"
          onClick={() => grade(true)}
          className={`${btn.primary} h-12`}
        >
          <CheckIcon className="h-4 w-4" />
          Know
          <kbd className="ml-1 hidden rounded-chip border border-line bg-surface-sunken px-1.5 font-mono text-[11px] text-ink-subtle sm:inline">→</kbd>
        </button>
      </div>

      <div className="mt-3 text-center text-xs text-ink-subtle">
        <span className="font-medium text-success">{knownSoFar} known</span> ·{" "}
        <span className="font-medium text-danger">{missedSoFar} missed</span>
      </div>
    </div>
  );
}
