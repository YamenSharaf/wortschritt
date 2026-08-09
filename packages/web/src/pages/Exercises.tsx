import { useState } from "react";
import { Link } from "react-router-dom";
import type { RunSummary } from "@mdb/shared";
import { SortControl, sortByMode, type SortMode } from "../components/SortControl";
import { api } from "../lib/api";
import { timeAgo } from "../lib/time";
import { useAsync } from "../lib/useAsync";

export function Exercises() {
  const exercises = useAsync(() => api.exercises(), []);
  const runs = useAsync(() => api.runs(), []);
  const [sort, setSort] = useState<SortMode>("recent");
  const lastRun: Record<string, RunSummary> = {};
  if (runs.status === "ready") for (const r of runs.data) lastRun[r.setId] = r;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Exercises</h1>
        {exercises.status === "ready" && exercises.data.length > 1 && (
          <SortControl value={sort} onChange={setSort} />
        )}
      </div>
      {exercises.status === "loading" && <p className="text-slate-500">Loading…</p>}
      {exercises.status === "ready" && exercises.data.length === 0 && (
        <p className="text-slate-500">
          No exercises yet. Add some via{" "}
          <Link className="underline" to="/import">
            Import
          </Link>
          .
        </p>
      )}
      {exercises.status === "ready" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {sortByMode(exercises.data, sort).map((set) => (
            <Link
              key={set.id}
              to={`/exercises/${set.id}`}
              className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{set.title}</span>
                <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                  {set.level}
                </span>
              </div>
              {set.subtitle && (
                <p className="text-xs text-slate-400">{set.subtitle}</p>
              )}
              {set.description && (
                <p className="mt-1 text-sm text-slate-500">{set.description}</p>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs text-slate-400">
                  {set.items.length} tasks · {set.tags.join(", ")}
                </p>
                <LastRunBadge run={lastRun[set.id]} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Last: 15/21" pill, tinted by accuracy; nothing if never attempted. */
export function LastRunBadge({ run }: { run?: RunSummary }) {
  if (!run) return null;
  const pct = run.answered ? run.correct / run.answered : 0;
  const tone =
    pct >= 0.8
      ? "text-green-600 dark:text-green-400"
      : pct >= 0.5
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  return (
    <span
      className="shrink-0 whitespace-nowrap text-xs text-slate-400"
      title={`Last run ${timeAgo(run.finishedAt)}`}
    >
      Last:{" "}
      <span className={`font-medium tabular-nums ${tone}`}>
        {run.correct}/{run.answered}
      </span>
    </span>
  );
}
