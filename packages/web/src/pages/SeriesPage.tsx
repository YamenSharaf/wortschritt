import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { SeriesChapter, SeriesView, StoryAudioBrief } from "@mdb/shared";
import { playInPlayer } from "../components/Player";
import { retryText } from "@mdb/client";
import { clock, useListening, useStoryAudio } from "../lib/listening";
import { Cover } from "../components/Cover";
import { CoverUpload } from "../components/CoverUpload";
import { CheckIcon, ChevronLeftIcon, ClockIcon, DownloadIcon, HeadphonesIcon, PlayIcon, TrashIcon } from "../components/icons";
import { Pill, btn } from "../components/ui";
import { api } from "../lib/api";

/** A book: what it's about, how far you are, and its chapters. */
export function SeriesPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<SeriesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { audio, refresh } = useStoryAudio();

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

      <AudiobookBox book={view} audio={audio} onChange={refresh} />

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
                  <ChapterAudio storyId={c.storyId} title={c.title} book={view.title} audio={audio[c.storyId]} />
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

type Written = SeriesChapter & { storyId: string };

/**
 * The book as an audiobook: how many chapters have audio, "Generate
 * audiobook" (only when asked — it queues every chapter in order and uses
 * the voice's free limit as it comes back), and play from where you are.
 */
function AudiobookBox({ book: b, audio, onChange }: { book: SeriesView; audio: Record<string, StoryAudioBrief>; onChange: () => void }) {
  const ls = useListening();
  const [asking, setAsking] = useState(false);
  const written = b.chapters.filter((c): c is Written => !!c.storyId);
  if (!ls.enabled || written.length === 0) return null;

  const isReady = (c: Written) => audio[c.storyId]?.state === "ready";
  const ready = written.filter(isReady);
  const queued = written.filter((c) => audio[c.storyId]?.state === "building" || audio[c.storyId]?.state === "waiting");
  const failed = written.filter((c) => audio[c.storyId]?.state === "error");
  const waiting = written.map((c) => audio[c.storyId]).find((a) => a?.state === "waiting");
  const missing = written.filter((c) => !isReady(c) && !queued.includes(c));
  const from = written.find((c) => c.storyId === b.continueId && isReady(c)) ?? ready[0];
  const saved = from ? ls.positions[from.storyId] : undefined;
  const minutes = Math.round(ready.reduce((n, c) => n + (audio[c.storyId]?.duration ?? 0), 0) / 60);
  const pct = Math.round((ready.length / written.length) * 100);

  const explain =
    ready.length === written.length
      ? `All ${written.length} chapters are ready${minutes ? ` · ${minutes} min` : ""}.`
      : waiting
        ? `${waiting.waitReason ?? "Waiting for the voice's limit"}. It carries on by itself${waiting.retryAt ? ` ${retryText(waiting.retryAt)}` : ""}, chapter by chapter; the chapters made already can be played.`
        : queued.length
          ? "Making the audio, chapter by chapter. You can listen to the ready ones already."
          : failed.length
            ? `${failed.length} chapter${failed.length === 1 ? "" : "s"} couldn't be made. Try again?`
            : ready.length
              ? `${missing.length} chapter${missing.length === 1 ? "" : "s"} still without audio.`
              : "Turn the book into audio to listen with the tab in the background or the screen off.";

  async function generate() {
    setAsking(true);
    try {
      await api.startSeriesAudio(b.id);
      onChange();
    } catch (e) {
      window.alert(`Couldn't generate the audiobook: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card" aria-label="Audiobook">
      <div className="flex items-center gap-2">
        <HeadphonesIcon className="h-[18px] w-[18px] text-brand-ink" />
        <h2 className="flex-1 font-semibold">Audiobook</h2>
        <span className="text-sm tabular-nums text-ink-subtle">
          {ready.length} of {written.length} ready
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-ink-muted">{explain}</p>
      <div className="flex flex-wrap gap-2">
        {from && (
          <button type="button" className={btn.primary} onClick={() => playInPlayer({ id: from.storyId, title: from.title, book: b.title }, ls)}>
            <PlayIcon className="h-4 w-4" />
            {saved && !saved.done && saved.t > 5 ? `Continue · Chapter ${from.chapter}` : `Play from chapter ${from.chapter}`}
          </button>
        )}
        {(missing.length > 0 || failed.length > 0) && (
          <button type="button" className={btn.secondary} disabled={asking} onClick={() => void generate()}>
            <HeadphonesIcon className="h-4 w-4" />
            {asking ? "Asking…" : ready.length || queued.length ? `Generate the rest (${missing.length})` : "Generate audiobook"}
          </button>
        )}
      </div>
    </section>
  );
}

/** A chapter row's audio: play when it's ready, a clock while it's being made. */
function ChapterAudio({ storyId, title, book, audio }: { storyId: string; title: string; book: string; audio: StoryAudioBrief | undefined }) {
  const ls = useListening();
  if (!ls.enabled) return null;
  if (audio?.state === "building" || audio?.state === "waiting")
    return (
      <span className={`px-2 ${audio.state === "waiting" ? "text-warning" : "text-ink-subtle"}`} title={audio.state === "waiting" ? (audio.waitReason ?? "Waiting for the voice's limit") : "Making the audio"}>
        <ClockIcon className="h-4 w-4" />
      </span>
    );
  if (audio?.state !== "ready") return null;
  const saved = ls.positions[storyId];
  return (
    <button
      type="button"
      onClick={() => playInPlayer({ id: storyId, title, book }, ls)}
      className="mx-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-ink hover:bg-brand-soft/80"
      aria-label={`Listen to ${title}${saved && !saved.done && saved.t > 5 ? `, ${clock(saved.duration - saved.t)} left` : ""}`}
    >
      <PlayIcon className="h-3.5 w-3.5" />
    </button>
  );
}
