import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { SeriesView } from "@mdb/shared";
import { Cover } from "../components/Cover";
import { CoverUpload } from "../components/CoverUpload";
import { CheckIcon, ChevronLeftIcon, DownloadIcon, PlayIcon, TrashIcon } from "../components/icons";
import { Pill, btn } from "../components/ui";
import { api } from "../lib/api";

/** A book: what it's about, how far you are, and its chapters. */
export function SeriesPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<SeriesView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .series(id)
        .then(setView)
        .catch(() => setError("This book doesn't exist (or isn't yours).")),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div>
<Link to="/stories" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
          <ChevronLeftIcon className="h-4 w-4" />
          Stories
        </Link>
        <p className="mt-4 text-danger">{error}</p>
      </div>
    );
  }
  if (!view) return <p className="text-ink-muted">Loading…</p>;

  const started = view.status !== "unread";
  const percent = Math.round(view.progress * 100);

  async function remove() {
    if (!window.confirm(`Delete “${view!.title}” and all ${view!.written} chapters? Your answers stay in your history.`)) return;
    await api.deleteSeries(view!.id);
    navigate("/stories");
  }

  return (
    <div className="space-y-8">
      <Link to="/stories" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeftIcon className="h-4 w-4" />
        Stories
      </Link>

      <header className="relative flex gap-6 overflow-hidden rounded-panel border border-line bg-surface p-5 shadow-card sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-40 aspect-square w-[30rem] bg-[radial-gradient(closest-side,var(--glow),transparent)]"
        />
        <div className="relative w-28 shrink-0 space-y-2 sm:w-40">
          <Cover
            kind="series"
            id={view.id}
            version={view.cover}
            fallbackKey={`${view.title}-${view.subtitle ?? ""}-${view.level}`}
            className="w-full"
          />
          <CoverUpload kind="series" id={view.id} hasArt={Boolean(view.cover)} onChange={() => void load()} />
        </div>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Book</p>
          <h1 className="mt-1 text-balance text-[28px] font-semibold leading-[34px] tracking-[-0.02em] sm:text-[34px] sm:leading-[40px]" lang="de">
            {view.title}
          </h1>
          {view.subtitle && <p className="mt-1 text-ink-muted">{view.subtitle}</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill>{view.level}</Pill>
            <Pill>{view.written < view.total ? `${view.written} of ${view.total} chapters written` : `${view.total} chapters`}</Pill>
          </div>
          {view.description && (
            <p className="mt-4 max-w-prose font-content leading-relaxed text-ink-muted" lang="de">
              {view.description}
            </p>
          )}
          {view.written > 0 && (
            <div className="mt-auto space-y-3 pt-5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm text-ink-muted">
                  <span>
                    {view.read} of {view.total} chapters read
                  </span>
                  <span className="tabular-nums">{percent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--reward-1),var(--reward-2),var(--reward-3))]" style={{ width: `${percent}%` }} />
                </div>
              </div>
              {view.continueId && view.read < view.written && (
                <Link to={`/stories/${view.continueId}`} className={btn.primary}>
                  <PlayIcon className="h-4 w-4" />
                  {started ? "Continue reading" : "Start reading"}
                </Link>
              )}
            </div>
          )}
        </div>
      </header>

      <h2 className="-mb-4 text-xl font-semibold tracking-[-0.01em]">Chapters</h2>

      <ol className="divide-y divide-[var(--border)] overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {view.chapters.map((c) => {
          const body = (
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="w-6 shrink-0 text-right font-mono text-sm tabular-nums text-ink-subtle">{c.chapter}</span>
              {c.storyId ? (
                <Cover kind="story" id={c.storyId} version={c.cover} fallbackKey={`${c.title}-${c.level}`} className="w-9 shrink-0" />
              ) : (
                <span className="aspect-[2/3] w-9 shrink-0 rounded-[6px] border border-dashed border-line-control" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className={`truncate ${c.storyId ? "font-medium" : "text-ink-subtle"}`} lang="de">
                  {c.title}
                </div>
                <div className="text-xs text-ink-subtle">
                  {c.storyId
                    ? `${c.minutes} min${c.level && c.level !== view.level ? ` · ${c.level}` : ""}`
                    : "Not written yet"}
                </div>
              </div>
              {c.status === "read" ? (
                <Pill tone="success">
                  <CheckIcon className="h-3 w-3" />
                  Read
                </Pill>
              ) : c.status === "reading" ? (
                <Pill tone="brand">{Math.round(c.progress * 100)}%</Pill>
              ) : null}
            </div>
          );
          return (
            <li key={c.chapter} className="flex items-center">
              {c.storyId ? (
                <>
                  <Link to={`/stories/${c.storyId}`} className="block min-w-0 flex-1 transition-colors hover:bg-surface-sunken">
                    {body}
                  </Link>
                  <span className="pr-2">
                    <CoverUpload kind="story" id={c.storyId} hasArt={Boolean(c.cover)} onChange={() => void load()} compact />
                  </span>
                </>
              ) : (
                <div className="min-w-0 flex-1">{body}</div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-sm text-ink-muted">
        Books are written by an AI agent connected via MCP (ask it to continue this one with its next chapters).
      </p>
      <div className="flex flex-wrap gap-2">
        {view.written > 0 && (
          <a
            href={api.epubUrl("series", view.id)}
            download
            className={btn.secondary}
            title="For e-readers: the German text with a table of contents and each chapter's word list"
          >
            <DownloadIcon className="h-4 w-4" />
            Download EPUB
          </a>
        )}
        <button type="button" onClick={() => void remove()} className={btn.danger}>
          <TrashIcon className="h-4 w-4" />
          Delete book
        </button>
      </div>
    </div>
  );
}
