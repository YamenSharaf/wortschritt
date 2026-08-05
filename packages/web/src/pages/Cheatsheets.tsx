import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

export function Cheatsheets() {
  const sheets = useAsync(() => api.cheatsheets(), []);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Cheat sheets</h1>
      {sheets.status === "loading" && <p className="text-slate-500">Lädt…</p>}
      {sheets.status === "ready" && sheets.data.length === 0 && (
        <p className="text-slate-500">Noch keine Cheat sheets.</p>
      )}
      {sheets.status === "ready" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {sheets.data.map((s) => (
            <Link
              key={s.id}
              to={`/cheatsheets/${s.id}`}
              className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="font-medium">{s.title}</div>
              <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                {s.category}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
