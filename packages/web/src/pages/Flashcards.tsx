import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { VocabEntry } from "@mdb/shared";
import { SpeakButton } from "../components/SpeakButton";
import { useVocab } from "../lib/vocab";

type Dir = "de" | "en";
const DIR_KEY = "mdb-flashcard-dir";

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

  const pool = useMemo(
    () =>
      entries.filter((e) => groupId == null || e.groups.includes(groupId)),
    [entries, groupId],
  );

  const [dir, setDir] = useState<Dir>(() => {
    try {
      return (localStorage.getItem(DIR_KEY) as Dir) || "de";
    } catch {
      return "de";
    }
  });
  const [queue, setQueue] = useState<VocabEntry[]>([]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<"loading" | "playing" | "done">("loading");

  function start(list: VocabEntry[]) {
    setQueue(shuffle(list));
    setI(0);
    setFlipped(false);
    setResults({});
    setPhase("playing");
  }

  // Kick off once the vocab has loaded (context fetches asynchronously).
  useEffect(() => {
    if (phase === "loading" && pool.length > 0) start(pool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length]);

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

  const card = queue[i];

  function grade(known: boolean) {
    if (!card) return;
    setResults((r) => ({ ...r, [card.word]: known }));
    void recordStudy(card.word, known).catch(() => {});
    if (i + 1 < queue.length) {
      setI(i + 1);
      setFlipped(false);
    } else {
      setPhase("done");
    }
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
    <Link to="/vocab" className="text-sm text-slate-500 hover:underline">
      ← Vocab
    </Link>
  );

  if (phase === "loading") {
    return (
      <div className="space-y-4">
        {back}
        {entries.length > 0 && pool.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
            No words in “{groupName}” yet. Add some, then come back to study.
          </p>
        ) : (
          <p className="text-slate-500">Loading…</p>
        )}
      </div>
    );
  }

  if (phase === "done") {
    const total = queue.length;
    const knownCount = queue.filter((c) => results[c.word]).length;
    const missed = queue.filter((c) => results[c.word] === false);
    const pct = total ? Math.round((knownCount / total) * 100) : 0;
    return (
      <div className="mx-auto max-w-md space-y-5">
        {back}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
          <div className="text-5xl font-bold">{pct}%</div>
          <p className="mt-1 text-slate-500">
            You knew <span className="font-semibold text-slate-700 dark:text-slate-200">{knownCount}</span> of {total} in “{groupName}”.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            {missed.length > 0 && (
              <button
                type="button"
                onClick={() => start(missed)}
                className="rounded-lg bg-accent px-4 py-2.5 font-medium text-accent-foreground"
              >
                ↻ Review the {missed.length} you missed
              </button>
            )}
            <button
              type="button"
              onClick={() => start(pool)}
              className="rounded-lg border border-slate-300 px-4 py-2.5 font-medium hover:border-slate-500 dark:border-slate-700"
            >
              Study all {pool.length} again
            </button>
            <button
              type="button"
              onClick={() => navigate("/vocab")}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // playing
  const knownSoFar = Object.values(results).filter(Boolean).length;
  const missedSoFar = Object.values(results).filter((v) => !v).length;
  const promptText = dir === "de" ? card.display : card.translation;
  const answerText = dir === "de" ? card.translation : card.display;

  return (
    <div className="mx-auto max-w-md">
      <div className="flex items-center justify-between gap-2">
        {back}
        <button
          type="button"
          onClick={toggleDir}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:border-slate-500 dark:border-slate-700"
          title="Switch which side is shown first"
        >
          {dir === "de" ? "DE → EN" : "EN → DE"}
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span>{groupName}</span>
        <span>
          {i + 1} / {queue.length}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${((i + (flipped ? 0.5 : 0)) / queue.length) * 100}%` }}
        />
      </div>

      <button
        type="button"
        onClick={() => setFlipped(true)}
        className="mt-4 flex min-h-[16rem] w-full cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-6 text-left dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {dir === "de" ? "German" : "English"}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-content text-3xl font-semibold">{promptText}</span>
          {dir === "de" && <SpeakButton text={card.display} />}
        </div>

        {flipped ? (
          <div className="mt-5 border-t border-slate-200 pt-4 font-content dark:border-slate-700">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {dir === "de" ? "English" : "German"}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xl text-slate-700 dark:text-slate-200">{answerText}</span>
              {dir === "en" && <SpeakButton text={card.display} />}
            </div>
            {card.examples.length > 0 && (
              <div className="mt-3 space-y-2">
                {card.examples.slice(0, 2).map((ex, k) => (
                  <div key={k} className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-slate-800 dark:text-slate-100">{ex.de}</p>
                      <SpeakButton text={ex.de} className="-mr-1 -mt-1" />
                    </div>
                    <p className="text-slate-500">{ex.en}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-auto pt-6 text-sm text-slate-400">
            Tap to reveal · <span className="hidden sm:inline">Space</span>
          </div>
        )}
      </button>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => grade(false)}
          className="rounded-xl border border-red-200 bg-red-50 py-3 font-semibold text-red-700 hover:border-red-300 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          ✗ Don’t know
          <span className="ml-1 hidden text-xs opacity-60 sm:inline">←</span>
        </button>
        <button
          type="button"
          onClick={() => grade(true)}
          className="rounded-xl border border-green-200 bg-green-50 py-3 font-semibold text-green-700 hover:border-green-300 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-300"
        >
          ✓ Know
          <span className="ml-1 hidden text-xs opacity-60 sm:inline">→</span>
        </button>
      </div>

      <div className="mt-3 text-center text-xs text-slate-400">
        <span className="text-green-600">{knownSoFar} known</span> ·{" "}
        <span className="text-red-500">{missedSoFar} missed</span>
      </div>
    </div>
  );
}
