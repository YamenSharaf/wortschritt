import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SearchBox } from "../components/SearchBox";
import { SortControl, sortByMode, type SortMode } from "../components/SortControl";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

export function Cheatsheets() {
  const sheets = useAsync(() => api.cheatsheets(), []);
  const [sort, setSort] = useState<SortMode>("recent");
  const [q, setQ] = useState("");

  const list = sheets.status === "ready" ? sheets.data : [];
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return list;
    return list.filter((s) =>
      [s.title, s.subtitle, s.category].some((v) =>
        (v ?? "").toLowerCase().includes(n),
      ),
    );
  }, [list, q]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Cheat sheets</h1>
        {list.length > 1 && <SortControl value={sort} onChange={setSort} />}
      </div>
      {list.length > 3 && (
        <div className="mb-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search cheat sheets…" />
        </div>
      )}
      {sheets.status === "loading" && <p className="text-slate-500">Loading…</p>}
      {sheets.status === "ready" && sheets.data.length === 0 && (
        <p className="text-slate-500">No cheat sheets yet.</p>
      )}
      {sheets.status === "ready" && filtered.length === 0 && sheets.data.length > 0 && (
        <p className="text-slate-500">No cheat sheets match.</p>
      )}
      {sheets.status === "ready" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {sortByMode(filtered, sort).map((s) => (
            <Link
              key={s.id}
              to={`/cheatsheets/${s.id}`}
              className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="font-medium">{s.title}</div>
              {s.subtitle && (
                <div className="text-xs text-slate-400">{s.subtitle}</div>
              )}
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
