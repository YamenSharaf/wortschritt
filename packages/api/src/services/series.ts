import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  chapterStoryId,
  series as seriesSchema,
  story as storySchema,
  storyParagraphs,
  type Series,
  type SeriesChapter,
  type SeriesSummary,
  type SeriesView,
  type Story,
  type StoryView,
} from "@mdb/shared";
import { db, schema } from "../db/client";
import { getStory, pruneTranslations, wordCount } from "./stories";

/**
 * Series: books whose chapters are stories (private, like stories). The
 * series holds the story bible and outline; each chapter is a story row with
 * series_id, its number and a summary for continuity. Chapters may be
 * written in any order (gaps show as planned chapters).
 */

const key = (userId: number, id: string) => and(eq(schema.series.userId, userId), eq(schema.series.id, id));

function parseSeries(data: unknown): Series | null {
  const r = seriesSchema.safeParse(data);
  return r.success ? r.data : null;
}

function chapterRows(userId: number, seriesId: string) {
  return db
    .select()
    .from(schema.stories)
    .where(and(eq(schema.stories.userId, userId), eq(schema.stories.seriesId, seriesId)))
    .orderBy(asc(schema.stories.chapter))
    .all();
}

/** Written chapters merged with the outline's planned ones, in order. */
function chaptersOf(s: Series, rows: ReturnType<typeof chapterRows>): SeriesChapter[] {
  const written = new Map(rows.map((r) => [r.chapter ?? 0, r]));
  const total = Math.max(s.outline.length, ...rows.map((r) => r.chapter ?? 0), 0);
  const out: SeriesChapter[] = [];
  for (let n = 1; n <= total; n++) {
    const row = written.get(n);
    const story = row ? storySchema.safeParse(row.data) : null;
    if (row && story?.success) {
      out.push({
        chapter: n,
        storyId: row.id,
        title: story.data.title,
        level: story.data.level,
        words: wordCount(story.data.body),
        progress: row.progress,
        readAt: row.readAt,
        summary: row.summary,
      });
    } else {
      out.push({
        chapter: n,
        storyId: null,
        title: s.outline[n - 1]?.title ?? `Kapitel ${n}`,
        level: null,
        words: 0,
        progress: 0,
        readAt: null,
        summary: null,
      });
    }
  }
  return out;
}

function summarize(id: string, s: Series, chapters: SeriesChapter[], updatedAt: number): SeriesSummary {
  const written = chapters.filter((c) => c.storyId);
  const total = Math.max(chapters.length, 1);
  const done = written.reduce((sum, c) => sum + (c.readAt ? 1 : Math.min(c.progress, 1)), 0);
  // Continue with the first written chapter not finished yet, else the last one.
  const next = written.find((c) => !c.readAt) ?? written.at(-1);
  return {
    id,
    title: s.title,
    subtitle: s.subtitle,
    level: s.level,
    description: s.description,
    written: written.length,
    total: chapters.length,
    read: written.filter((c) => c.readAt).length,
    progress: Math.min(1, done / total),
    continueId: next?.storyId ?? null,
    updatedAt,
  };
}

export function listSeries(userId: number): SeriesSummary[] {
  return db
    .select()
    .from(schema.series)
    .where(eq(schema.series.userId, userId))
    .orderBy(desc(schema.series.updatedAt))
    .all()
    .flatMap((row) => {
      const s = parseSeries(row.data);
      if (!s) return [];
      const rows = chapterRows(userId, row.id);
      const lastChange = Math.max(row.updatedAt, ...rows.map((r) => r.updatedAt));
      return [summarize(row.id, s, chaptersOf(s, rows), lastChange)];
    });
}

export function getSeriesView(userId: number, id: string): SeriesView | null {
  const row = db.select().from(schema.series).where(key(userId, id)).get();
  const s = row && parseSeries(row.data);
  if (!row || !s) return null;
  const rows = chapterRows(userId, id);
  const chapters = chaptersOf(s, rows);
  const lastChange = Math.max(row.updatedAt, ...rows.map((r) => r.updatedAt));
  return { ...summarize(id, s, chapters, lastChange), series: s, chapters };
}

/**
 * What a writer needs for the next chapter: the series (bible, outline),
 * every chapter's summary, and the end of the latest written chapter.
 */
export function getSeriesForWriting(userId: number, id: string) {
  const view = getSeriesView(userId, id);
  if (!view) return null;
  const written = view.chapters.filter((c) => c.storyId);
  const latest = written.at(-1);
  const latestStory = latest?.storyId ? getStory(userId, latest.storyId)?.story : null;
  return {
    series: view.series,
    chapters: view.chapters.map((c) => ({
      chapter: c.chapter,
      title: c.title,
      written: Boolean(c.storyId),
      storyId: c.storyId,
      level: c.level,
      words: c.words,
      summary: c.summary,
    })),
    nextChapter: view.chapters.find((c) => !c.storyId)?.chapter ?? view.chapters.length + 1,
    latestEnding: latestStory
      ? { chapter: latest!.chapter, text: storyParagraphs(latestStory.body).slice(-2).join("\n\n") }
      : null,
  };
}

export function saveSeries(
  userId: number,
  s: Series,
  { overwrite = false }: { overwrite?: boolean } = {},
): { ok: true; replaced: boolean; view: SeriesView } | { ok: false; error: string } {
  const exists = Boolean(db.select({ id: schema.series.id }).from(schema.series).where(key(userId, s.id)).get());
  if (exists && !overwrite) {
    return { ok: false, error: `you already have a series "${s.id}"; choose another id or pass overwrite: true` };
  }
  db.insert(schema.series)
    .values({ userId, id: s.id, data: s })
    .onConflictDoUpdate({
      target: [schema.series.userId, schema.series.id],
      set: { data: s, updatedAt: sql`(unixepoch())` },
    })
    .run();
  return { ok: true, replaced: exists, view: getSeriesView(userId, s.id)! };
}

/** Delete a series and all its chapters. */
export function deleteSeries(userId: number, id: string): boolean {
  return db.transaction((tx) => {
    tx.delete(schema.stories)
      .where(and(eq(schema.stories.userId, userId), eq(schema.stories.seriesId, id)))
      .run();
    return tx.delete(schema.series).where(key(userId, id)).run().changes > 0;
  });
}

export type ChapterResult =
  | { ok: true; replaced: boolean; view: StoryView }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Save chapter `n` of a series. Its story id is derived ("<series>-01"); an
 * existing chapter is only replaced with `overwrite` (reading progress kept).
 */
export function saveChapter(
  userId: number,
  seriesId: string,
  n: number,
  story: Story,
  summary: string,
  { overwrite = false }: { overwrite?: boolean } = {},
): ChapterResult {
  if (!db.select({ id: schema.series.id }).from(schema.series).where(key(userId, seriesId)).get()) {
    return { ok: false, status: 404, error: `no series "${seriesId}"` };
  }
  const id = chapterStoryId(seriesId, n);
  const chapterStory: Story = { ...story, id };
  const existing = db
    .select({ seriesId: schema.stories.seriesId, chapter: schema.stories.chapter })
    .from(schema.stories)
    .where(and(eq(schema.stories.userId, userId), eq(schema.stories.id, id)))
    .get();
  if (existing && (existing.seriesId !== seriesId || existing.chapter !== n)) {
    return { ok: false, status: 409, error: `a story with the id "${id}" already exists outside this series` };
  }
  if (existing && !overwrite) {
    return { ok: false, status: 409, error: `chapter ${n} already exists; pass overwrite: true to replace it` };
  }
  if (existing) pruneTranslations(userId, id, chapterStory.body);
  db.insert(schema.stories)
    .values({ userId, id, data: chapterStory, seriesId, chapter: n, summary: summary.trim() })
    .onConflictDoUpdate({
      target: [schema.stories.userId, schema.stories.id],
      set: { data: chapterStory, summary: summary.trim(), updatedAt: sql`(unixepoch())` },
    })
    .run();
  db.update(schema.series).set({ updatedAt: sql`(unixepoch())` }).where(key(userId, seriesId)).run();
  return { ok: true, replaced: Boolean(existing), view: getStory(userId, id)! };
}
