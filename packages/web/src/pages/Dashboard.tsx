import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { storySetId, type RunSummary } from "@mdb/shared";
import { PlayIcon, StarIcon } from "../components/icons";
import { Pill, SectionHeading, btn, cardLink } from "../components/ui";
import { SectionIcon, type Section } from "../components/SectionIcon";
import { api } from "../lib/api";
import { useAuth } from "@mdb/client/react";
import { timeAgo } from "@mdb/client";
import { useAsync, useFavorites } from "@mdb/client/react";
import { LastRunBadge } from "./Exercises";

export function Dashboard() {
  const { user } = useAuth();
  const progress = useAsync(() => api.progress(), []);
  const settings = useAsync(() => api.settings(), []);
  const exercises = useAsync(() => api.exercises(), []);
  const runs = useAsync(() => api.runs(), []);
  // Items generated for this learner count towards a set's size.
  const extra = useAsync(() => api.generatedCounts().catch(() => ({}) as Record<string, number>), []);
  const size = (set: { id: string; items: unknown[] }) => set.items.length + (extra.status === "ready" ? (extra.data[set.id] ?? 0) : 0);
  const allSheets = useAsync(() => api.cheatsheets(), []);
  const favorites = useFavorites();
  const [allFavorites, setAllFavorites] = useState(false);
  const sheets = useAsync(() => api.sheetViews(5), []);
  const notes = useAsync(() => api.notes(), []);
  const recentRuns = runs.status === "ready" ? runs.data.slice(0, 5) : [];
  const recentSheets = sheets.status === "ready" ? sheets.data.slice(0, 4) : [];
  const recentNotes = notes.status === "ready" ? notes.data.slice(0, 4) : [];

  const lastRun: Record<string, RunSummary> = {};
  if (runs.status === "ready") for (const r of runs.data) lastRun[r.setId] = r;

  // Starred sets and sheets that are still in the library, newest first.
  type FavoriteRow = { key: string; to: string; section: Section; title: string; meta: string; run?: RunSummary };
  const favoriteRows: FavoriteRow[] =
    exercises.status === "ready" && allSheets.status === "ready"
      ? favorites.list.flatMap((f): FavoriteRow[] => {
          if (f.kind === "exercise") {
            const set = exercises.data.find((x) => x.id === f.id);
            return set ? [{ key: `e:${f.id}`, to: `/exercises/${f.id}`, section: "practice" as const, title: set.title, meta: `Exercises · ${size(set)} tasks`, run: lastRun[f.id] }] : [];
          }
          const sheet = allSheets.data.find((x) => x.id === f.id);
          return sheet ? [{ key: `c:${f.id}`, to: `/cheatsheets/${f.id}`, section: "sheets" as const, title: sheet.title, meta: "Cheat sheet", run: undefined }] : [];
        })
      : [];

  const name =
    (settings.status === "ready" && settings.data.displayName.trim()) || user?.username || "";
  const p = progress.status === "ready" ? progress.data : null;
  const left = p?.goalLeft ?? 0;
  // The server picks it: an unfinished set first, else the last run's set.
  const next = p?.continue ?? null;
  const continueTo = next ? setHref(next.setId, next.kind) : "/exercises";

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-panel border border-line bg-surface px-6 py-8 shadow-card sm:px-8 sm:py-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-40 aspect-square w-[34rem] bg-[radial-gradient(closest-side,var(--glow),transparent)]"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-8">
          <div className="min-w-0 max-w-xl space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <h1 className="text-balance text-[34px] font-semibold leading-[40px] tracking-[-0.025em] sm:text-[40px] sm:leading-[44px]">
              {greeting()}
              {name && `, ${name}`}
            </h1>
            <p className="text-ink-muted">
              {!p
                ? " "
                : left > 0
                  ? `${left} ${left === 1 ? "answer" : "answers"} left to reach today's goal.`
                  : "Today's goal is done. Anything more is a bonus."}
            </p>
            <div className="flex flex-wrap gap-2 pt-3">
              <Link
                to={continueTo}
                className={btn.primary}
              >
                <PlayIcon className="h-4 w-4" />
                {next ? "Continue practice" : "Start practising"}
              </Link>
              <Link
                to="/vocab/study"
                className={btn.ghost}
              >
                Review words
              </Link>
            </div>
          </div>
          {p && <GoalRing done={p.answeredToday} goal={p.dailyGoal} percent={p.goalPercent} accuracy={p.accuracy} total={p.totalAnswered} />}
        </div>
      </section>

      {(recentRuns.length > 0 || recentSheets.length > 0 || recentNotes.length > 0) && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {recentRuns.length > 0 && (
            <ListSection title="Recent practice" more={{ to: "/exercises", label: "All exercises" }}>
              {recentRuns.map((r) => (
                <Row
                  key={r.setId}
                  to={setHref(r.setId, r.kind)}
                  section={r.kind === "story" ? "stories" : "practice"}
                  title={r.setTitle}
                  meta={timeAgo(r.finishedAt)}
                  end={<LastRunBadge run={r} />}
                />
              ))}
            </ListSection>
          )}
          {(recentSheets.length > 0 || recentNotes.length > 0) && (
            <div className="space-y-8">
              {recentSheets.length > 0 && (
                <ListSection title="Recently viewed" more={{ to: "/cheatsheets", label: "All sheets" }}>
                  {recentSheets.map((s) => (
                    <Row key={s.sheetId} to={`/cheatsheets/${s.sheetId}`} section="sheets" title={s.title} meta={timeAgo(s.viewedAt)} />
                  ))}
                </ListSection>
              )}
              {recentNotes.length > 0 && (
                <ListSection title="Recent notes" more={{ to: "/notes", label: "All notes" }}>
                  {recentNotes.map((n) => (
                    <Row
                      key={n.id}
                      to={`/notes/${n.id}`}
                      section="notes"
                      title={n.title.trim() || "Untitled"}
                      meta={[n.category.trim(), timeAgo(n.updatedAt)].filter(Boolean).join(" · ")}
                    />
                  ))}
                </ListSection>
              )}
            </div>
          )}
        </div>
      )}

      {favoriteRows.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-[-0.01em]">Favourites</h2>
            {favoriteRows.length > FAVORITES_SHOWN && (
              <button type="button" onClick={() => setAllFavorites((v) => !v)} className="text-sm font-medium text-ink-muted hover:text-ink">
                {allFavorites ? "Show fewer" : `Show all (${favoriteRows.length})`}
              </button>
            )}
          </div>
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-card border border-line bg-surface shadow-card">
            {(allFavorites ? favoriteRows : favoriteRows.slice(0, FAVORITES_SHOWN)).map((r) => (
              <Row
                key={r.key}
                to={r.to}
                section={r.section}
                title={r.title}
                meta={r.meta}
                end={r.run ? <LastRunBadge run={r.run} /> : <StarIcon className="h-4 w-4 fill-[var(--reward-1)] text-[#e0a800]" aria-hidden />}
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeading title="Exercises" more={{ to: "/exercises", label: "See all" }} />
        {exercises.status === "loading" && <p className="text-ink-muted">Loading…</p>}
        {exercises.status === "ready" && exercises.data.length === 0 && (
          <p className="text-ink-muted">
            No exercises yet. Add some via{" "}
            <Link className="text-brand-ink underline underline-offset-2" to="/import">
              Import
            </Link>
            .
          </p>
        )}
        {exercises.status === "ready" && exercises.data.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {exercises.data.slice(0, 4).map((set) => (
              <Link
                key={set.id}
                to={`/exercises/${set.id}`}
                className={cardLink}
              >
                <div className="flex items-start gap-3">
                  <SectionIcon section="practice" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold leading-6 tracking-[-0.005em]">{set.title}</h3>
                    {set.subtitle && <p className="text-sm text-ink-muted">{set.subtitle}</p>}
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Pill>{set.level}</Pill>
                  <Pill>{size(set)} tasks</Pill>
                  <span className="ml-auto">
                    <LastRunBadge run={lastRun[set.id]} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** How many favourites Home lists before "Show all". */
const FAVORITES_SHOWN = 3;

function greeting(): string {
  const h = new Date().getHours();
  return h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
}

/** The daily goal in the reward gradient, with all-time numbers under it. */
function GoalRing({ done, goal, percent: pct, accuracy, total }: { done: number; goal: number; percent: number; accuracy: number | null; total: number }) {
  return (
    <div className="flex items-center gap-4">
      <div
        role="img"
        aria-label={`Daily goal: ${done} of ${goal} answers`}
        className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
        style={{
          background: `conic-gradient(from -90deg, var(--reward-1), var(--reward-2), var(--reward-3) ${pct}%, var(--surface-sunken) 0)`,
        }}
      >
        <span className="grid h-[78px] w-[78px] place-items-center rounded-full bg-surface font-mono text-base font-medium tabular-nums">
          {pct}%
        </span>
      </div>
      <dl className="space-y-1 text-sm">
        <div>
          <dt className="sr-only">Today</dt>
          <dd className="font-medium tabular-nums">
            {done} of {goal} today
          </dd>
        </div>
        <div className="text-ink-muted">
          <dt className="inline">Accuracy </dt>
          <dd className="inline tabular-nums">{accuracy === null ? "—" : `${accuracy}%`}</dd>
        </div>
        <div className="text-ink-muted">
          <dd className="inline tabular-nums">{total}</dd>
          <dt className="inline"> answered in total</dt>
        </div>
      </dl>
    </div>
  );
}

function ListSection({ title, more, children }: { title: string; more?: { to: string; label: string }; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <SectionHeading title={title} more={more} />
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {children}
      </div>
    </section>
  );
}

function Row({ to, section, title, meta, end }: { to: string; section: Section; title: string; meta?: string; end?: ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken">
      <SectionIcon section={section} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-6">{title}</p>
        {meta && <p className="truncate text-xs text-ink-subtle">{meta}</p>}
      </div>
      {end}
    </Link>
  );
}

/** A set's page: an exercise set, or a story whose questions were answered. */
function setHref(setId: string, kind: RunSummary["kind"]): string {
  return kind === "story" ? `/stories/${setId.slice(storySetId("").length)}` : `/exercises/${setId}`;
}
