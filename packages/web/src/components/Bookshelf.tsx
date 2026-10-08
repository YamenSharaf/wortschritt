import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SeriesSummary } from "@mdb/shared";
import { Cover } from "./Cover";
import { TabPills } from "./TabPills";

/**
 * The learner's books: a grid of covers, or a list. The
 * choice is remembered on this device.
 */
type View = "covers" | "list";
const VIEW_KEY = "mdb.shelfView";

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "covers";
  } catch {
    return "covers";
  }
}

export function Bookshelf({ books }: { books: SeriesSummary[] }) {
  const [view, setView] = useState<View>(loadView);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private mode: just not remembered */
    }
  }, [view]);

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Books</h2>
        <TabPills
          size="sm"
          label="Shelf view"
          value={view}
          onChange={setView}
          options={[
            { value: "covers", label: "Covers" },
            { value: "list", label: "List" },
          ]}
        />
      </div>
      {view === "covers" ? (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5">
          {books.map((b) => (
            <FaceOut key={b.id} book={b} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {books.map((b) => (
            <ListItem key={b.id} book={b} />
          ))}
        </div>
      )}
    </section>
  );
}

const label = (b: SeriesSummary) =>
  `${b.title}${b.read === b.total && b.total > 0 ? " — read" : b.progress > 0.01 ? ` — ${Math.round(b.progress * 100)}% read` : ""}`;

/** A ribbon bookmark (in progress) or a tick (finished). */
function Marker({ book }: { book: SeriesSummary }) {
  if (book.read === book.total && book.total > 0) {
    return (
      <span className="absolute -right-1.5 -top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full bg-green-600 text-[10px] text-white shadow" aria-hidden>
        ✓
      </span>
    );
  }
  if (book.progress <= 0.01) return null;
  return (
    <span
      className="absolute -top-2 right-3 z-10 h-7 w-2.5 bg-accent shadow-sm"
      style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%)" }}
      aria-hidden
    />
  );
}

function FaceOut({ book }: { book: SeriesSummary }) {
  return (
    <Link to={`/series/${book.id}`} aria-label={label(book)} title={label(book)} className="group relative block min-w-0">
      <Marker book={book} />
      <div className="relative transition-transform duration-200 group-hover:-translate-y-1">
        <Cover
          kind="series"
          id={book.id}
          version={book.cover}
          fallbackKey={`${book.title}-${book.subtitle ?? ""}-${book.level}`}
          className="block w-full !rounded-[3px] !ring-0 !shadow-[0_2px_10px_rgba(0,0,0,.14)] transition-shadow group-hover:!shadow-[0_6px_18px_rgba(0,0,0,.2)]"
        />
      </div>
    </Link>
  );
}

function ListItem({ book }: { book: SeriesSummary }) {
  const done = book.read === book.total && book.total > 0;
  return (
    <Link
      to={`/series/${book.id}`}
      className="relative flex gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900"
    >
      <Cover
        kind="series"
        id={book.id}
        version={book.cover}
        fallbackKey={`${book.title}-${book.subtitle ?? ""}-${book.level}`}
        className="w-14 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium" lang="de">
              {book.title}
            </div>
            {book.subtitle && <div className="text-xs text-slate-400">{book.subtitle}</div>}
          </div>
          <span className="shrink-0 rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-500 dark:border-slate-700">
            {book.level}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-500">
          <span>{book.written === book.total ? `${book.total} chapters` : `${book.written} of ${book.total} chapters written`}</span>
          {book.read > 0 && (
            <span className={done ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>
              {done ? "Read ✓" : `${Math.round(book.progress * 100)}% read`}
            </span>
          )}
        </div>
      </div>
      {book.progress > 0.01 && !done && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-100 dark:bg-slate-800">
          <div className="h-full bg-accent" style={{ width: `${Math.round(book.progress * 100)}%` }} />
        </div>
      )}
    </Link>
  );
}
