import type { SeriesSummary, StorySummary } from "@mdb/shared";

/** A book or short story to read on, as Home suggests it. */
export type ReadingItem = {
  kind: "series" | "story";
  id: string;
  /** The story that opens (a book's next chapter). */
  storyId: string;
  title: string;
  /** "Book · 40% read", "Story · A2 · 4 min". */
  detail: string;
  cover: string | null;
  /** Changes when a generated cover would. */
  coverKey: string;
};

/**
 * What to read next: books and short stories in progress, the most recently
 * changed first; with nothing in progress, the newest unread ones (`reading`
 * says which). Chapters count through their book.
 */
export function recentReading(stories: StorySummary[], books: SeriesSummary[], limit: number): { items: ReadingItem[]; reading: boolean } {
  const pick = (status: "reading" | "unread") =>
    [
      ...books.filter((b) => b.status === status && b.continueId).map((b) => ({ at: b.updatedAt, item: bookItem(b) })),
      ...stories.filter((s) => !s.seriesId && s.status === status).map((s) => ({ at: s.updatedAt, item: storyItem(s) })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map((x) => x.item);
  const reading = pick("reading");
  return reading.length > 0 ? { items: reading, reading: true } : { items: pick("unread"), reading: false };
}

function bookItem(b: SeriesSummary): ReadingItem {
  return {
    kind: "series",
    id: b.id,
    storyId: b.continueId!,
    title: b.title,
    detail: b.status === "reading" ? `Book · ${Math.round(b.progress * 100)}% read` : `Book · ${b.written} ${b.written === 1 ? "chapter" : "chapters"}`,
    cover: b.cover,
    coverKey: `${b.title}-${b.subtitle ?? ""}-${b.level}`,
  };
}

function storyItem(s: StorySummary): ReadingItem {
  return {
    kind: "story",
    id: s.id,
    storyId: s.id,
    title: s.title,
    detail: s.status === "reading" ? `Story · ${Math.round(s.progress * 100)}% read` : `Story · ${s.level} · ${s.minutes} min`,
    cover: s.cover,
    coverKey: `${s.title}-${s.level}`,
  };
}
