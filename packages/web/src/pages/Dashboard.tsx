import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

export function Dashboard() {
  const progress = useAsync(() => api.progress(), []);
  const exercises = useAsync(() => api.exercises(), []);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-4 text-2xl font-bold">Willkommen zurück 👋</h1>
        {progress.status === "ready" && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Heute" value={`${progress.data.answeredToday}/${progress.data.dailyGoal}`} />
            <Stat label="Beantwortet" value={progress.data.totalAnswered} />
            <Stat label="Richtig" value={progress.data.totalCorrect} />
            <Stat
              label="Genauigkeit"
              value={
                progress.data.totalAnswered
                  ? `${Math.round((progress.data.totalCorrect / progress.data.totalAnswered) * 100)}%`
                  : "—"
              }
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Übungen</h2>
        {exercises.status === "loading" && <p className="text-slate-500">Lädt…</p>}
        {exercises.status === "ready" && exercises.data.length === 0 && (
          <p className="text-slate-500">
            Noch keine Übungen. Füge welche über <Link className="underline" to="/import">Import</Link> hinzu.
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
                <div className="flex items-center justify-between">
                  <span className="font-medium">{set.title}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                    {set.level}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {set.items.length} Aufgaben
                </p>
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
