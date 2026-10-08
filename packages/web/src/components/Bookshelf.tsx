import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { SeriesSummary } from "@mdb/shared";
import { Cover } from "./Cover";

/**
 * The learner's books: face-out covers on wooden shelves, or a list. The
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

const GAP = 12;
const PAD = 12;

export function Bookshelf({ books }: { books: SeriesSummary[] }) {
  const [view, setView] = useState<View>(loadView);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private mode: just not remembered */
    }
  }, [view]);

  const inner = Math.max(0, width - PAD * 2);
  const rows = width && view === "covers" ? coverRows(books, inner) : [];

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Books</h2>
        <div className="flex rounded-lg border border-slate-300 p-0.5 text-xs dark:border-slate-700" role="group" aria-label="Shelf view">
          {(["covers", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded-md px-2.5 py-1 capitalize ${view === v ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-500"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className={view === "covers" ? "space-y-6" : "grid gap-3 sm:grid-cols-2"}>
        {view === "covers"
          ? rows.map((row, i) => (
              <Shelf key={i}>
                {row.items.map((b) => (
                  <FaceOut key={b.id} book={b} width={row.bookWidth} />
                ))}
              </Shelf>
            ))
          : books.map((b) => <ListItem key={b.id} book={b} />)}
      </div>
    </section>
  );
}

/** A plank with books standing on it. */
function Shelf({ children }: { children: ReactNode }) {
  return (
    <div>
      <div className="flex items-end gap-3 px-3" style={{ minHeight: 40 }}>
        {children}
      </div>
      <div
        className="relative h-3.5 rounded-sm"
        style={{
          background: "linear-gradient(#c08a5a, #9a6a40 55%, #7d5332)",
          boxShadow: "0 8px 12px -6px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.25)",
        }}
        aria-hidden
      />
    </div>
  );
}

type CoverRow = { items: SeriesSummary[]; bookWidth: number };

function coverRows(books: SeriesSummary[], inner: number): CoverRow[] {
  const perRow = Math.max(2, Math.min(6, Math.floor((inner + GAP) / (100 + GAP))));
  const bookWidth = Math.min(160, (inner - GAP * (perRow - 1)) / perRow);
  const rows: CoverRow[] = [];
  for (let i = 0; i < books.length; i += perRow) rows.push({ items: books.slice(i, i + perRow), bookWidth });
  return rows;
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

function FaceOut({ book, width }: { book: SeriesSummary; width: number }) {
  return (
    <Link to={`/series/${book.id}`} aria-label={label(book)} title={label(book)} className="group relative shrink-0" style={{ width }}>
      <Marker book={book} />
      <div className="relative transition-transform duration-200 group-hover:-translate-y-1">
        <Cover
          kind="series"
          id={book.id}
          version={book.cover}
          fallbackKey={`${book.title}-${book.subtitle ?? ""}-${book.level}`}
          className="block w-full !rounded-none !rounded-r-[3px] shadow-[2px_3px_6px_rgba(0,0,0,.35)]"
        />
        {/* The spine's crease and the page edge, for a bit of depth. */}
        <span
          className="pointer-events-none absolute inset-y-0 left-0 w-[8%]"
          style={{ background: "linear-gradient(90deg, rgba(0,0,0,.35), rgba(255,255,255,.18) 45%, rgba(0,0,0,.08) 70%, transparent)" }}
          aria-hidden
        />
        <span
          className="pointer-events-none absolute -right-[3px] bottom-[3px] top-[3px] w-[3px] rounded-r-sm"
          style={{ background: "repeating-linear-gradient(#f8f3e6 0 1px, #ddd3bd 1px 2px)" }}
          aria-hidden
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
