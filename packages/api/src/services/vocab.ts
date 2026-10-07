import { and, desc, eq, sql } from "drizzle-orm";
import type {
  SaveVocabBody,
  VocabEntry,
  VocabForms,
  VocabGroup,
  VocabStat,
} from "@mdb/shared";
import { db, schema } from "../db/client";
import { formsFor } from "./dict";

const key = (w: string) => w.trim().toLowerCase();

// Vocabulary is private: every query below is scoped to one user.
const vocabKey = (userId: number, word: string) =>
  and(eq(schema.vocab.userId, userId), eq(schema.vocab.word, key(word)));
const statKey = (userId: number, word: string) =>
  and(eq(schema.vocabStats.userId, userId), eq(schema.vocabStats.word, key(word)));

type VocabRow = typeof schema.vocab.$inferSelect;
function toEntry(
  { userId: _owner, ...r }: VocabRow,
  groups: number[],
  stats: VocabStat | null,
): VocabEntry {
  return { ...r, groups, stats, forms: displayForms(r.display, r.forms) };
}

/** Merge the offline-derived forms (pos, Partizip II, article, plural) with the
 *  AI-supplied stored forms (which add the perfect auxiliary). Offline wins for
 *  the fields it knows; stored fills the rest. */
function displayForms(
  display: string,
  stored: Record<string, string> | null,
): VocabForms | null {
  const offline = formsFor(display);
  if (!offline && !stored) return null;
  const s = stored ?? {};
  return {
    pos: offline?.pos ?? s.pos ?? null,
    article: offline?.article ?? s.article ?? null,
    plural: offline?.plural ?? s.plural ?? null,
    partizip2: offline?.partizip2 ?? s.partizip2 ?? null,
    auxiliary: s.auxiliary ?? null,
  };
}

type StatRow = typeof schema.vocabStats.$inferSelect;
function toStat(r: StatRow): VocabStat {
  return {
    known: r.known,
    missed: r.missed,
    lastResult: r.lastResult == null ? null : r.lastResult === 1,
    lastStudiedAt: r.lastStudiedAt ?? null,
  };
}

/** group_id list for each word, so entries can carry their memberships. */
function membershipByWord(userId: number): Map<string, number[]> {
  const rows = db
    .select()
    .from(schema.vocabGroupMembers)
    .where(eq(schema.vocabGroupMembers.userId, userId))
    .all();
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const list = map.get(r.word) ?? [];
    list.push(r.groupId);
    map.set(r.word, list);
  }
  return map;
}

function statsByWord(userId: number): Map<string, VocabStat> {
  const rows = db
    .select()
    .from(schema.vocabStats)
    .where(eq(schema.vocabStats.userId, userId))
    .all();
  const map = new Map<string, VocabStat>();
  for (const r of rows) map.set(r.word, toStat(r));
  return map;
}

export function listVocab(userId: number): VocabEntry[] {
  const rows = db
    .select()
    .from(schema.vocab)
    .where(eq(schema.vocab.userId, userId))
    .orderBy(desc(schema.vocab.createdAt))
    .all();
  const groups = membershipByWord(userId);
  const stats = statsByWord(userId);
  return rows.map((r) =>
    toEntry(r, groups.get(r.word) ?? [], stats.get(r.word) ?? null),
  );
}

export function getVocab(userId: number, word: string): VocabEntry | null {
  const r = db.select().from(schema.vocab).where(vocabKey(userId, word)).get();
  if (!r) return null;
  const groups = db
    .select()
    .from(schema.vocabGroupMembers)
    .where(
      and(
        eq(schema.vocabGroupMembers.userId, userId),
        eq(schema.vocabGroupMembers.word, r.word),
      ),
    )
    .all()
    .map((m) => m.groupId);
  const stat = db.select().from(schema.vocabStats).where(statKey(userId, r.word)).get();
  return toEntry(r, groups, stat ? toStat(stat) : null);
}

/** Record one flashcard grade for a word; increments the running tally. */
export function recordStudy(userId: number, word: string, known: boolean): VocabStat {
  const w = key(word);
  db.insert(schema.vocabReviews).values({ userId, word: w, known }).run();
  db.insert(schema.vocabStats)
    .values({
      userId,
      word: w,
      known: known ? 1 : 0,
      missed: known ? 0 : 1,
      lastResult: known ? 1 : 0,
      lastStudiedAt: sql`(unixepoch())`,
    })
    .onConflictDoUpdate({
      target: [schema.vocabStats.userId, schema.vocabStats.word],
      set: {
        known: sql`${schema.vocabStats.known} + ${known ? 1 : 0}`,
        missed: sql`${schema.vocabStats.missed} + ${known ? 0 : 1}`,
        lastResult: known ? 1 : 0,
        lastStudiedAt: sql`(unixepoch())`,
      },
    })
    .run();
  const row = db.select().from(schema.vocabStats).where(statKey(userId, w)).get();
  return toStat(row!);
}

/** Clear a word's flashcard tally. */
export function resetStudy(userId: number, word: string): void {
  db.delete(schema.vocabStats).where(statKey(userId, word)).run();
}

/** Drop empty AI form fields; null when nothing usable remains. */
function cleanForms(
  f: SaveVocabBody["forms"],
): Record<string, string> | null {
  if (!f) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}

/** Insert or update by normalized word; preserves the original createdAt. */
export function upsertVocab(userId: number, body: SaveVocabBody): VocabEntry {
  const word = key(body.word);
  const forms = cleanForms(body.forms);
  const row = {
    userId,
    word,
    display: (body.display ?? body.word).trim(),
    translation: body.translation,
    examples: body.examples,
    forms,
  };
  db.insert(schema.vocab)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.vocab.userId, schema.vocab.word],
      set: {
        display: row.display,
        translation: row.translation,
        examples: row.examples,
        // Keep existing forms when this save didn't provide any.
        forms: sql`COALESCE(excluded.forms, ${schema.vocab.forms})`,
      },
    })
    .run();
  return getVocab(userId, word)!;
}

export function removeVocab(userId: number, word: string): void {
  db.delete(schema.vocab).where(vocabKey(userId, word)).run();
  db.delete(schema.vocabGroupMembers)
    .where(
      and(
        eq(schema.vocabGroupMembers.userId, userId),
        eq(schema.vocabGroupMembers.word, key(word)),
      ),
    )
    .run();
  db.delete(schema.vocabStats).where(statKey(userId, word)).run();
  db.delete(schema.vocabReviews)
    .where(and(eq(schema.vocabReviews.userId, userId), eq(schema.vocabReviews.word, key(word))))
    .run();
}

// --- groups ----------------------------------------------------------------

export function listGroups(userId: number): VocabGroup[] {
  return db.all(sql`
    SELECT g.id AS id, g.name AS name, g.created_at AS createdAt,
           (SELECT count(*) FROM vocab_group_members m WHERE m.group_id = g.id) AS count
    FROM vocab_groups g
    WHERE g.user_id = ${userId}
    ORDER BY g.name COLLATE NOCASE ASC
  `) as VocabGroup[];
}

/** Whether group `id` exists and belongs to the user. */
export function ownsGroup(userId: number, id: number): boolean {
  return Boolean(
    db
      .select({ id: schema.vocabGroups.id })
      .from(schema.vocabGroups)
      .where(and(eq(schema.vocabGroups.id, id), eq(schema.vocabGroups.userId, userId)))
      .get(),
  );
}

export function createGroup(userId: number, name: string): VocabGroup {
  const res = db
    .insert(schema.vocabGroups)
    .values({ userId, name: name.trim() })
    .run();
  const id = Number(res.lastInsertRowid);
  return { id, name: name.trim(), count: 0, createdAt: 0 };
}

// The group mutations below are no-ops for groups the user doesn't own.

export function deleteGroup(userId: number, id: number): void {
  if (!ownsGroup(userId, id)) return;
  db.delete(schema.vocabGroups).where(eq(schema.vocabGroups.id, id)).run();
  db.delete(schema.vocabGroupMembers)
    .where(eq(schema.vocabGroupMembers.groupId, id))
    .run();
}

export function addWordToGroup(userId: number, id: number, word: string): void {
  if (!ownsGroup(userId, id)) return;
  db.insert(schema.vocabGroupMembers)
    .values({ groupId: id, userId, word: key(word) })
    .onConflictDoNothing()
    .run();
}

export function removeWordFromGroup(userId: number, id: number, word: string): void {
  if (!ownsGroup(userId, id)) return;
  db.delete(schema.vocabGroupMembers)
    .where(
      and(
        eq(schema.vocabGroupMembers.groupId, id),
        eq(schema.vocabGroupMembers.word, key(word)),
      ),
    )
    .run();
}
