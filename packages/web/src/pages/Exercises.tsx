import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

export function Exercises() {
  const exercises = useAsync(() => api.exercises(), []);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Übungen</h1>
      {exercises.status === "loading" && <p className="text-slate-500">Lädt…</p>}
      {exercises.status === "ready" && exercises.data.length === 0 && (
        <p className="text-slate-500">
          Noch keine Übungen. Füge welche über{" "}
          <Link className="underline" to="/import">
            Import
          </Link>{" "}
          hinzu.
        </p>
      )}
      {exercises.status === "ready" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {exercises.data.map((set) => (
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
              {set.description && (
                <p className="mt-1 text-sm text-slate-500">{set.description}</p>
              )}
              <p className="mt-2 text-xs text-slate-400">
                {set.items.length} Aufgaben · {set.tags.join(", ")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
