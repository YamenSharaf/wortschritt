import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { RunSummary } from "@mdb/shared";
import { ImportIcon } from "../components/icons";
import { SearchBox } from "../components/SearchBox";
import { SectionIcon } from "../components/SectionIcon";
import { SortControl, sortByMode, type SortMode } from "../components/SortControl";
import { Muted, PageHeader, Pill, btn, cardLink } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo } from "@mdb/client";
import { useAsync } from "@mdb/client/react";

export function Exercises() {
  const exercises = useAsync(() => api.exercises(), []);
  const runs = useAsync(() => api.runs(), []);
  // Items generated for this learner count towards a set's size.
  const extra = useAsync(() => api.generatedCounts().catch(() => ({}) as Record<string, number>), []);
  const size = (set: { id: string; items: unknown[] }) => set.items.length + (extra.status === "ready" ? (extra.data[set.id] ?? 0) : 0);
  const [sort, setSort] = useState<SortMode>("recent");
  const [q, setQ] = useState("");
  const lastRun: Record<string, RunSummary> = {};
  if (runs.status === "ready") for (const r of runs.data) lastRun[r.setId] = r;

  const list = exercises.status === "ready" ? exercises.data : [];
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return list;
    return list.filter((s) =>
      [s.title, s.subtitle, s.description, ...s.tags].some((v) =>
        (v ?? "").toLowerCase().includes(n),
      ),
    );
  }, [list, q]);

  return (
    <div>
      <PageHeader
        title="Practice"
        subtitle="Exercise sets for grammar and vocabulary. Wrong answers come back until you get them."
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
        <div className="mb-5">
          <SearchBox value={q} onChange={setQ} placeholder="Search exercises…" />
        </div>
      )}
      {exercises.status === "loading" && <Muted>Loading…</Muted>}
      {exercises.status === "ready" && exercises.data.length === 0 && (
        <Muted>
          No exercises yet. Add some via{" "}
          <Link className="text-brand-ink underline underline-offset-2" to="/import">
            Import
          </Link>
          .
        </Muted>
      )}
      {exercises.status === "ready" && filtered.length === 0 && exercises.data.length > 0 && (
        <Muted>No exercises match.</Muted>
      )}
      {exercises.status === "ready" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {sortByMode(filtered, sort).map((set) => (
            <Link key={set.id} to={`/exercises/${set.id}`} className={`${cardLink} flex flex-col`}>
              <div className="flex items-start gap-3">
                <SectionIcon section="practice" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold leading-6 tracking-[-0.005em]">{set.title}</h2>
                  {set.subtitle && <p className="text-sm text-ink-muted">{set.subtitle}</p>}
                </div>
              </div>
              {set.description && <p className="mt-3 text-sm leading-5 text-ink-muted">{set.description}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                <Pill>{set.level}</Pill>
                <Pill>{size(set)} tasks</Pill>
                {set.tags.slice(0, 2).map((t) => (
                  <Pill key={t}>{t}</Pill>
                ))}
                <span className="ml-auto">
                  <LastRunBadge run={lastRun[set.id]} />
                </span>
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
  // The server says how the score reads.
  const tone = run.tier === "good" ? "text-success" : run.tier === "ok" ? "text-warning" : "text-danger";
  return (
    <span
      className="shrink-0 whitespace-nowrap text-xs text-ink-subtle"
      title={`Last run ${timeAgo(run.finishedAt)}`}
    >
      Last:{" "}
      <span className={`font-medium tabular-nums ${tone}`}>
        {run.correct}/{run.answered}
      </span>
    </span>
  );
}
