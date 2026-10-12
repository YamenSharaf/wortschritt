import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ImportIcon } from "../components/icons";
import { SearchBox } from "../components/SearchBox";
import { SectionIcon } from "../components/SectionIcon";
import { SortControl, sortByMode, type SortMode } from "../components/SortControl";
import { PageHeader, Pill, btn, cardLink } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "@mdb/client/react";
import { StarButton } from "../components/StarButton";

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
      <PageHeader
        title="Cheat sheets"
        subtitle="Grammar at a glance. Tap any word to look it up."
        actions={
          <>
            {list.length > 1 && <SortControl value={sort} onChange={setSort} />}
            <Link to="/import" className={btn.secondary}>
              <ImportIcon className="h-4 w-4" />
              Import
            </Link>
          </>
        }
      />
      {list.length > 3 && (
        <div className="mb-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search cheat sheets…" />
        </div>
      )}
      {sheets.status === "loading" && <p className="text-ink-muted">Loading…</p>}
      {sheets.status === "ready" && sheets.data.length === 0 && (
        <p className="text-ink-muted">No cheat sheets yet.</p>
      )}
      {sheets.status === "ready" && filtered.length === 0 && sheets.data.length > 0 && (
        <p className="text-ink-muted">No cheat sheets match.</p>
      )}
      {sheets.status === "ready" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {sortByMode(filtered, sort).map((s) => (
            <Link
              key={s.id}
              to={`/cheatsheets/${s.id}`}
              className={`${cardLink} flex items-start gap-3`}
            >
              <SectionIcon section="sheets" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold leading-6 tracking-[-0.005em]">{s.title}</h2>
                {s.subtitle && <p className="text-sm text-ink-muted">{s.subtitle}</p>}
                {s.category && (
                  <div className="mt-3">
                    <Pill>{s.category}</Pill>
                  </div>
                )}
              </div>
              <StarButton kind="cheatsheet" id={s.id} title={s.title} className="-mr-2 -mt-1" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
