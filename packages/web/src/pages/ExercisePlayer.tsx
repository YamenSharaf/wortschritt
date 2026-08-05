import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ExerciseItemView } from "../components/ExerciseItemView";
import { api } from "../lib/api";
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
  const [done, setDone] = useState(false);

  const item = items[index]!;

  function handleAnswered(correct: boolean) {
    if (answered) return;
    setAnswered(true);
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
        <ExerciseItemView key={item.id} item={item} onAnswered={handleAnswered} />
      </div>

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
