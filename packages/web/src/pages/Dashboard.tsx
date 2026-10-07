import { Link } from "react-router-dom";
import type { RunSummary } from "@mdb/shared";
import { api } from "../lib/api";
import { timeAgo } from "../lib/time";
import { useAsync } from "../lib/useAsync";
import { LastRunBadge } from "./Exercises";

export function Dashboard() {
  const progress = useAsync(() => api.progress(), []);
  const exercises = useAsync(() => api.exercises(), []);
  const runs = useAsync(() => api.runs(), []);
  const sheets = useAsync(() => api.sheetViews(5), []);
  const notes = useAsync(() => api.notes(), []);
  const recentRuns = runs.status === "ready" ? runs.data.slice(0, 5) : [];
  const recentNotes = notes.status === "ready" ? notes.data.slice(0, 4) : [];

  const lastRun: Record<string, RunSummary> = {};
  if (runs.status === "ready") for (const r of runs.data) lastRun[r.setId] = r;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-4 text-2xl font-bold">Welcome back 👋</h1>
        {progress.status === "ready" && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Today" value={`${progress.data.answeredToday}/${progress.data.dailyGoal}`} />
            <Stat label="Answered" value={progress.data.totalAnswered} />
            <Stat label="Correct" value={progress.data.totalCorrect} />
            <Stat
              label="Accuracy"
              value={
                progress.data.totalAnswered
                  ? `${Math.round((progress.data.totalCorrect / progress.data.totalAnswered) * 100)}%`
                  : "—"
              }
            />
          </div>
        )}
      </section>

      {recentRuns.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Recent practice</h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {recentRuns.map((r) => (
              <Link
                key={r.setId}
                to={runHref(r.setId)}
                className="flex items-center justify-between gap-3 bg-white px-4 py-3 hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.setTitle}</p>
                  <p className="text-xs text-slate-400">{timeAgo(r.finishedAt)}</p>
                </div>
                <LastRunBadge run={r} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {sheets.status === "ready" && sheets.data.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Recently viewed</h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {sheets.data.map((s) => (
              <Link
                key={s.sheetId}
                to={`/cheatsheets/${s.sheetId}`}
                className="flex items-center justify-between gap-3 bg-white px-4 py-3 hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
              >
                <p className="min-w-0 truncate font-medium">{s.title}</p>
                <span className="shrink-0 text-xs text-slate-400">
                  {timeAgo(s.viewedAt)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {recentNotes.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Recent notes</h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {recentNotes.map((n) => (
              <Link
                key={n.id}
                to={`/notes/${n.id}`}
                className="flex items-center justify-between gap-3 bg-white px-4 py-3 hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {n.title.trim() || "Untitled"}
                  </p>
                  {n.category.trim() && (
                    <p className="truncate text-xs uppercase tracking-wide text-slate-500">
                      {n.category.trim()}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-slate-400">
                  {timeAgo(n.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Exercises</h2>
        {exercises.status === "loading" && <p className="text-slate-500">Loading…</p>}
        {exercises.status === "ready" && exercises.data.length === 0 && (
          <p className="text-slate-500">
            No exercises yet. Add some via <Link className="underline" to="/import">Import</Link>.
          </p>
        )}
        {exercises.status === "ready" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {exercises.data.slice(0, 4).map((set) => (
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
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-sm text-slate-500">{set.items.length} tasks</p>
                  <LastRunBadge run={lastRun[set.id]} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

/** A run's page: an exercise set, or a story whose questions were answered. */
function runHref(setId: string): string {
  return setId.startsWith("story:") ? `/stories/${setId.slice(6)}` : `/exercises/${setId}`;
}
