import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SeriesSummary } from "@mdb/shared";
import { Cover } from "./Cover";
import { CheckIcon } from "./icons";
import { TabPills } from "./TabPills";
import { Pill, cardLink } from "./ui";

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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">Books</h2>
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
      <span className="absolute -right-1.5 -top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border-2 border-[var(--bg)] bg-success text-[var(--surface)] shadow-card" aria-hidden>
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (book.progress <= 0.01) return null;
  return (
    <span
      className="absolute -top-2 right-3 z-10 h-7 w-2.5 bg-[linear-gradient(180deg,var(--reward-2),var(--reward-3))] shadow-card"
      style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%)" }}
      aria-hidden
    />
  );
}

function FaceOut({ book }: { book: SeriesSummary }) {
  return (
    <Link to={`/series/${book.id}`} aria-label={label(book)} title={label(book)} className="group relative block min-w-0">
      <Marker book={book} />
      <div className="relative transition-transform duration-200 group-hover:-translate-y-1 motion-reduce:group-hover:translate-y-0">
        <Cover
          kind="series"
          id={book.id}
          version={book.cover}
          fallbackKey={`${book.title}-${book.subtitle ?? ""}-${book.level}`}
          className="block w-full !rounded-[6px] !ring-1 !ring-[var(--border)] !shadow-[0_2px_10px_rgba(0,0,0,.14)] transition-shadow group-hover:!shadow-[0_10px_24px_rgba(0,0,0,.22)]"
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
      className={`${cardLink} relative flex gap-4 overflow-hidden !p-4`}
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
            <h3 className="font-semibold leading-6 tracking-[-0.005em]" lang="de">
              {book.title}
            </h3>
            {book.subtitle && <p className="text-sm text-ink-muted">{book.subtitle}</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Pill>{book.level}</Pill>
          <Pill>{book.written === book.total ? `${book.total} chapters` : `${book.written} of ${book.total} written`}</Pill>
          {book.read > 0 && (
            <Pill tone={done ? "success" : "brand"}>
              {done && <CheckIcon className="h-3 w-3" />}
              {done ? "Read" : `${Math.round(book.progress * 100)}% read`}
            </Pill>
          )}
        </div>
      </div>
      {book.progress > 0.01 && !done && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-sunken">
          <div className="h-full bg-brand" style={{ width: `${Math.round(book.progress * 100)}%` }} />
        </div>
      )}
    </Link>
  );
}
