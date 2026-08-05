import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ExerciseItem } from "@mdb/shared";
import { ExerciseItemView } from "../components/ExerciseItemView";
import { api, askAssistant } from "../lib/api";
import { describeItem } from "../lib/describeItem";
import { useAsync } from "../lib/useAsync";

export function ExercisePlayer() {
  const { id } = useParams();
  const set = useAsync(() => api.exercise(id!), [id]);

  if (set.status === "loading")
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

  return <Runner setId={set.data.id} items={set.data.items} title={set.data.title} />;
}

function Runner({
  setId,
  items,
  title,
}: {
  setId: string;
  items: import("@mdb/shared").ExerciseItem[];
  title: string;
}) {
  const [index, setIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [lastCorrect, setLastCorrect] = useState(false);
  const [lastResponse, setLastResponse] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [llmGrading, setLlmGrading] = useState(false);

  useEffect(() => {
    // The tutor powers the Hint / Why-wrong buttons; llmGrading additionally
    // gates AI grading of free-text answers.
    Promise.all([api.assistantStatus(), api.settings()])
      .then(([st, se]) => {
        setAssistantEnabled(st.enabled);
        setLlmGrading(Boolean(st.enabled && se.llmGrading));
      })
      .catch(() => {});
  }, []);

  const item = items[index]!;

  function handleAnswered(correct: boolean, response?: string) {
    if (answered) return;
    setAnswered(true);
    setLastCorrect(correct);
    setLastResponse(response);
    if (correct) setCorrectCount((c) => c + 1);
    // Fire-and-forget; a failed save shouldn't block practice.
    void api.recordAttempt(setId, item.id, correct).catch(() => {});
  }

  function next() {
    if (index + 1 >= items.length) {
      setDone(true);
    } else {
      setIndex((i) => i + 1);
      setAnswered(false);
      setLastResponse(undefined);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="mb-2 text-2xl font-bold">Done! 🎉</h1>
        <p className="mb-6 text-slate-500">
          {correctCount} / {items.length} correct
        </p>
        <Link
          to="/exercises"
          className="rounded-lg bg-slate-900 px-4 py-2 text-white dark:bg-white dark:text-slate-900"
        >
          Back to exercises
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
        <Link to="/exercises" className="hover:underline">
          ← {title}
        </Link>
        <span>
          {index + 1} / {items.length}
        </span>
      </div>
      <div className="mb-6 h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full bg-slate-900 transition-all dark:bg-white"
          style={{ width: `${((index + (answered ? 1 : 0)) / items.length) * 100}%` }}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <ExerciseItemView
          key={item.id}
          item={item}
          onAnswered={handleAnswered}
          llmGrading={llmGrading}
        />
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

      {answered && (
        <button
          type="button"
          onClick={next}
          className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2 font-medium text-white dark:bg-white dark:text-slate-900"
        >
          {index + 1 >= items.length ? "Finish" : "Next"}
        </button>
      )}
    </div>
  );
}

/** Inline AI help: a no-spoiler Hint, plus Why-was-I-wrong after a miss. */
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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const showWhyWrong = answered && !lastCorrect && lastResponse !== undefined;

  function run(task: "hint" | "why_wrong") {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setText("");
    askAssistant(
      { task, item: describeItem(item), response: lastResponse },
      (t) => setText((a) => a + t),
      controller.signal,
    )
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => run("hint")}
          className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:border-slate-500 dark:border-slate-700"
        >
          💡 Hint
        </button>
        {showWhyWrong && (
          <button
            type="button"
            onClick={() => run("why_wrong")}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:border-slate-500 dark:border-slate-700"
          >
            Why was I wrong?
          </button>
        )}
      </div>
      {(busy || text || error) && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
          {error ? (
            <span className="text-red-600">{error}</span>
          ) : (
            <p className="whitespace-pre-wrap leading-relaxed">
              {text}
              {busy && <span className="animate-pulse">▍</span>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
