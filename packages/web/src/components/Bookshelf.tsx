import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { SeriesSummary } from "@mdb/shared";
import { Cover } from "./Cover";

/**
 * The learner's books on wooden shelves: face-out covers, or spines side by
 * side like a real bookcase. The choice is remembered on this device.
 */
type View = "covers" | "spines";
const VIEW_KEY = "mdb.shelfView";

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "spines" ? "spines" : "covers";
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
  const rows = width ? (view === "covers" ? coverRows(books, inner) : spineRows(books, inner)) : [];

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Books</h2>
        <div className="flex rounded-lg border border-slate-300 p-0.5 text-xs dark:border-slate-700" role="group" aria-label="Shelf view">
          {(["covers", "spines"] as const).map((v) => (
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
      <div ref={ref} className="space-y-6">
        {rows.map((row, i) => (
          <Shelf key={`${view}-${i}`}>
            {view === "covers"
              ? row.items.map((b) => <FaceOut key={b.id} book={b} width={(row as CoverRow).bookWidth} />)
              : row.items.map((b) => <Spine key={b.id} book={b} />)}
          </Shelf>
        ))}
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

function spineWidth(b: SeriesSummary) {
  return 34 + Math.min(b.total, 12) * 2.5;
}

function spineRows(books: SeriesSummary[], inner: number): Array<{ items: SeriesSummary[] }> {
  const rows: Array<{ items: SeriesSummary[] }> = [];
  let row: SeriesSummary[] = [];
  let used = 0;
  for (const b of books) {
    const w = spineWidth(b) + GAP;
    if (row.length && used + w - GAP > inner) {
      rows.push({ items: row });
      row = [];
      used = 0;
    }
    row.push(b);
    used += w;
  }
  if (row.length) rows.push({ items: row });
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

/** Light text on dark spines and dark text on light ones. */
function inkFor(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1d1a17" : "#f4ead5";
}

/** Height varies a little per book, like a real shelf. */
function spineHeight(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 170 + (h % 40);
}

function Spine({ book }: { book: SeriesSummary }) {
  const ink = inkFor(book.color);
  return (
    <Link
      to={`/series/${book.id}`}
      aria-label={label(book)}
      title={label(book)}
      className="group relative shrink-0 transition-transform duration-200 hover:-translate-y-1.5"
      style={{ width: spineWidth(book), height: spineHeight(book.id) }}
    >
      <Marker book={book} />
      <div
        className="flex h-full flex-col items-center justify-between overflow-hidden rounded-[3px] py-3"
        style={{
          background: `linear-gradient(90deg, rgba(0,0,0,.28), rgba(255,255,255,.14) 22%, rgba(0,0,0,0) 45%, rgba(0,0,0,.22)), ${book.color}`,
          color: ink,
          boxShadow: "1px 2px 4px rgba(0,0,0,.35)",
        }}
      >
        <span className="h-1 w-full border-y opacity-60" style={{ borderColor: ink }} aria-hidden />
        <span
          className="min-h-0 flex-1 overflow-hidden py-2 text-center font-serif font-bold"
          // Long titles wrap onto a second line (column) instead of being cut.
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontSize: book.title.length > 16 ? 12 : 14,
            lineHeight: 1.1,
            whiteSpace: book.title.length > 16 ? "normal" : "nowrap",
          }}
          lang="de"
        >
          {book.title}
        </span>
        <span className="font-sans text-[10px] font-bold tracking-wider">{book.level}</span>
        <span className="mt-1.5 h-1 w-full border-y opacity-60" style={{ borderColor: ink }} aria-hidden />
      </div>
    </Link>
  );
}
