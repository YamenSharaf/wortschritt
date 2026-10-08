import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { SeriesView } from "@mdb/shared";
import { api } from "../lib/api";

/** A book: what it's about, how far you are, and its chapters. */
export function SeriesPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<SeriesView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .series(id)
      .then(setView)
      .catch(() => setError("This book doesn't exist (or isn't yours)."));
  }, [id]);

  if (error) {
    return (
      <div>
        <Link to="/stories" className="text-sm text-slate-500 hover:underline">
          ← Stories
        </Link>
        <p className="mt-4 text-red-600">{error}</p>
      </div>
    );
  }
  if (!view) return <p className="text-slate-500">Loading…</p>;

  const started = view.chapters.some((c) => c.progress > 0.02 || c.readAt);
  const percent = Math.round(view.progress * 100);

  async function remove() {
    if (!window.confirm(`Delete “${view!.title}” and all ${view!.written} chapters? Your answers stay in your history.`)) return;
    await api.deleteSeries(view!.id);
    navigate("/stories");
  }

  return (
    <div className="space-y-6">
      <Link to="/stories" className="text-sm text-slate-500 hover:underline">
        ← Stories
      </Link>

      <header className="flex gap-4">
        <div className="grid h-28 w-20 shrink-0 place-items-center rounded-lg bg-accent text-3xl text-accent-foreground shadow" aria-hidden>
          📖
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{view.title}</h1>
          {view.subtitle && <p className="text-sm text-slate-400">{view.subtitle}</p>}
          <p className="mt-1 text-sm text-slate-500">
            {view.level} · {view.total} chapters
            {view.written < view.total ? ` (${view.written} written so far)` : ""}
          </p>
        </div>
      </header>

      {view.description && (
        <p className="font-content leading-relaxed text-slate-700 dark:text-slate-200" lang="de">
          {view.description}
        </p>
      )}

      {view.written > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              {view.read} of {view.total} chapters read
            </span>
            <span>{percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
          {view.continueId && view.read < view.written && (
            <Link
              to={`/stories/${view.continueId}`}
              className="mt-2 inline-block rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground"
            >
              {started ? "Continue reading" : "Start reading"}
            </Link>
          )}
        </div>
      )}

      <ol className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {view.chapters.map((c) => {
          const body = (
            <div className="flex items-center gap-3 p-3">
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-slate-400">{c.chapter}</span>
              <div className="min-w-0 flex-1">
                <div className={`truncate ${c.storyId ? "font-medium" : "text-slate-400"}`} lang="de">
                  {c.title}
                </div>
                <div className="text-xs text-slate-500">
                  {c.storyId
                    ? `${Math.max(1, Math.round(c.words / 120))} min${c.level && c.level !== view.level ? ` · ${c.level}` : ""}`
                    : "Not written yet"}
                </div>
              </div>
              {c.readAt ? (
                <span className="text-sm text-green-600 dark:text-green-400" aria-label="Read">
                  ✓
                </span>
              ) : c.progress > 0.02 ? (
                <span className="text-xs text-amber-600 dark:text-amber-400">{Math.round(c.progress * 100)}%</span>
              ) : null}
            </div>
          );
          return (
            <li key={c.chapter}>
              {c.storyId ? (
                <Link to={`/stories/${c.storyId}`} className="block hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-sm text-slate-500">
        Books are written by an AI agent connected via MCP (ask it to continue this one with its next chapters).
      </p>
      <div className="flex flex-wrap gap-2">
        {view.written > 0 && (
          <a
            href={`/api/series/${view.id}/epub`}
            download
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-700"
            title="For e-readers: the German text with a table of contents and each chapter's word list"
          >
            Download EPUB
          </a>
        )}
        <button type="button" onClick={() => void remove()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-red-600 dark:border-slate-700">
          Delete book
        </button>
      </div>
    </div>
  );
}
