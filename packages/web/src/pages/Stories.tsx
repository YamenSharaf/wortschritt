import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SeriesSummary, StorySummary } from "@mdb/shared";
import { Cover } from "../components/Cover";
import { SearchBox } from "../components/SearchBox";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

/** Reading time at a learner's pace (~120 words a minute). */
const minutes = (words: number) => Math.max(1, Math.round(words / 120));

function status(s: StorySummary): { label: string; tone: string } | null {
  if (s.readAt) return { label: "Read ✓", tone: "text-green-600 dark:text-green-400" };
  if (s.progress > 0.02) return { label: `${Math.round(s.progress * 100)}% read`, tone: "text-amber-600 dark:text-amber-400" };
  return null;
}

/** The learner's own stories (private). */
export function StoriesPage() {
  const stories = useAsync(() => api.stories(), []);
  const books = useAsync(() => api.seriesList(), []);
  const [q, setQ] = useState("");
  // Chapters are reached through their book, not listed on their own.
  const list = stories.status === "ready" ? stories.data.filter((s) => !s.seriesId) : [];
  const bookList = books.status === "ready" ? books.data : [];
  const n = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!n) return list;
    return list.filter((s) =>
      [s.title, s.subtitle, s.level, ...s.tags].some((v) => (v ?? "").toLowerCase().includes(n)),
    );
  }, [list, n]);
  const filteredBooks = n
    ? bookList.filter((b) => [b.title, b.subtitle, b.description].some((v) => (v ?? "").toLowerCase().includes(n)))
    : bookList;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Stories</h1>
        <div className="flex gap-2">
          <Link
            to="/stories/new"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700"
          >
            Write
          </Link>
          <Link
            to="/stories/generate"
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
          >
            ✨ Generate
          </Link>
        </div>
      </div>
      {list.length + bookList.length > 3 && (
        <div className="mb-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search stories…" />
        </div>
      )}
      {stories.status === "loading" && <p className="text-slate-500">Loading…</p>}
      {stories.status === "error" && <p className="text-red-600">Couldn't load your stories.</p>}
      {filteredBooks.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Books</h2>
          <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
            {filteredBooks.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        </section>
      )}
      {filteredBooks.length > 0 && list.length > 0 && (
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Stories</h2>
      )}
      {stories.status === "ready" && list.length === 0 && bookList.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500 dark:border-slate-700">
          <p className="mb-1 font-medium text-slate-700 dark:text-slate-200">No stories yet</p>
          <p className="text-sm">
            <Link to="/stories/generate" className="underline">
              Generate one
            </Link>{" "}
            from a short description — tailored to your level, your mistakes and the words you're
            learning — or{" "}
            <Link to="/stories/new" className="underline">
              write or paste your own
            </Link>
            . Stories are private to you.
          </p>
        </div>
      )}
      {stories.status === "ready" && filtered.length === 0 && filteredBooks.length === 0 && list.length + bookList.length > 0 && (
        <p className="text-slate-500">No stories match.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((s) => {
          const st = status(s);
          return (
            <Link
              key={s.id}
              to={`/stories/${s.id}`}
              className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <Cover kind="story" id={s.id} version={s.cover} fallbackKey={`${s.title}-${s.level}`} className="w-10 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.title}</div>
                  {s.subtitle && <div className="text-xs text-slate-400">{s.subtitle}</div>}
                </div>
                <span className="shrink-0 rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-500 dark:border-slate-700">
                  {s.level}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-500">
                <span>{minutes(s.words)} min</span>
                {s.questions > 0 && <span>{s.questions} questions</span>}
                {st && <span className={st.tone}>{st.label}</span>}
              </div>
              {!s.readAt && s.progress > 0.02 && (
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-100 dark:bg-slate-800">
                  <div className="h-full bg-accent" style={{ width: `${Math.round(s.progress * 100)}%` }} />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** A book on the shelf: its cover, title and how far you've read. */
function BookCard({ book }: { book: SeriesSummary }) {
  const done = book.read === book.total && book.total > 0;
  return (
    <Link to={`/series/${book.id}`} className="group block min-w-0">
      <div className="relative">
        <Cover
          kind="series"
          id={book.id}
          version={book.cover}
          fallbackKey={`${book.title}-${book.subtitle ?? ""}-${book.level}`}
          className="w-full transition group-hover:-translate-y-0.5 group-hover:shadow-md"
        />
        {done && (
          <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-green-600 text-xs text-white shadow" aria-label="Read">
            ✓
          </span>
        )}
      </div>
      {book.progress > 0.01 && !done && (
        <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className="h-full bg-accent" style={{ width: `${Math.round(book.progress * 100)}%` }} />
        </div>
      )}
      <div className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug">{book.title}</div>
      <div className="text-xs text-slate-500">
        {book.level} ·{" "}
        {book.written === book.total ? `${book.total} chapters` : `${book.written}/${book.total} chapters`}
      </div>
    </Link>
  );
}
