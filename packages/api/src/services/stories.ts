import { and, desc, eq, sql } from "drizzle-orm";
import { story as storySchema, type ExerciseItem, type Story, type StorySummary, type StoryView } from "@mdb/shared";
import { db, schema } from "../db/client";

/**
 * Stories are private: every query is scoped to the learner. The JSON is
 * validated against `story` on the way in, and re-parsed on the way out so
 * fields added later get their defaults.
 */

const key = (userId: number, id: string) => and(eq(schema.stories.userId, userId), eq(schema.stories.id, id));
const now = () => Math.floor(Date.now() / 1000);

/** Rough word count of Markdown text. */
export function wordCount(markdown: string): number {
  return markdown
    .replace(/[#*_>`|[\]()-]/g, " ")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w)).length;
}

function parse(data: unknown): Story | null {
  const r = storySchema.safeParse(data);
  return r.success ? r.data : null;
}

export function listStories(userId: number): StorySummary[] {
  const out: StorySummary[] = [];
  for (const row of db
    .select()
    .from(schema.stories)
    .where(eq(schema.stories.userId, userId))
    .orderBy(desc(schema.stories.updatedAt))
    .all()) {
    const s = parse(row.data);
    if (!s) continue;
    out.push({
      id: s.id,
      title: s.title,
      subtitle: s.subtitle,
      level: s.level,
      tags: s.tags,
      words: wordCount(s.body),
      questions: s.questions.length,
      progress: row.progress,
      readAt: row.readAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
  return out;
}

export function getStory(userId: number, id: string): StoryView | null {
  const row = db.select().from(schema.stories).where(key(userId, id)).get();
  const s = row && parse(row.data);
  if (!row || !s) return null;
  return { story: s, progress: row.progress, readAt: row.readAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** Create a story; with `overwrite`, replace one with the same id. */
export function saveStory(
  userId: number,
  story: Story,
  { overwrite = false }: { overwrite?: boolean } = {},
): { ok: true; replaced: boolean; view: StoryView } | { ok: false; error: string } {
  const exists = Boolean(db.select({ id: schema.stories.id }).from(schema.stories).where(key(userId, story.id)).get());
  if (exists && !overwrite) {
    return { ok: false, error: `you already have a story "${story.id}"; choose another id or pass overwrite: true` };
  }
  db.insert(schema.stories)
    .values({ userId, id: story.id, data: story })
    .onConflictDoUpdate({
      target: [schema.stories.userId, schema.stories.id],
      set: { data: story, updatedAt: sql`(unixepoch())` },
    })
    .run();
  return { ok: true, replaced: exists, view: getStory(userId, story.id)! };
}

/** Replace an existing story's content (keeps its reading progress). */
export function updateStory(userId: number, id: string, story: Story): StoryView | null {
  const res = db
    .update(schema.stories)
    .set({ data: story, updatedAt: now() })
    .where(key(userId, id))
    .run();
  return res.changes ? getStory(userId, id) : null;
}

export function deleteStory(userId: number, id: string): boolean {
  return db.delete(schema.stories).where(key(userId, id)).run().changes > 0;
}

export function setStoryProgress(userId: number, id: string, progress: number, read?: boolean): boolean {
  const set: { progress: number; readAt?: number | null } = { progress };
  if (read !== undefined) set.readAt = read ? now() : null;
  return db.update(schema.stories).set(set).where(key(userId, id)).run().changes > 0;
}

/** The learner's stories' questions, as exercise "sets" for history lookups. */
export function storyQuestionSets(userId: number): Map<string, { title: string; items: ExerciseItem[] }> {
  const out = new Map<string, { title: string; items: ExerciseItem[] }>();
  for (const row of db.select().from(schema.stories).where(eq(schema.stories.userId, userId)).all()) {
    const s = parse(row.data);
    if (s) out.set(`story:${s.id}`, { title: s.title, items: s.questions });
  }
  return out;
}

/** Story rows for the activity timeline. */
export function storyTimeline(userId: number) {
  return db
    .select({ id: schema.stories.id, data: schema.stories.data, createdAt: schema.stories.createdAt, readAt: schema.stories.readAt })
    .from(schema.stories)
    .where(eq(schema.stories.userId, userId))
    .all()
    .map((r) => ({ id: r.id, title: (r.data as { title?: string }).title ?? r.id, createdAt: r.createdAt, readAt: r.readAt }));
}
