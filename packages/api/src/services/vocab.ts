import { desc, eq, sql } from "drizzle-orm";
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
function membershipByWord(): Map<string, number[]> {
  const rows = db.select().from(schema.vocabGroupMembers).all();
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const list = map.get(r.word) ?? [];
    list.push(r.groupId);
    map.set(r.word, list);
  }
  return map;
}

function statsByWord(): Map<string, VocabStat> {
  const rows = db.select().from(schema.vocabStats).all();
  const map = new Map<string, VocabStat>();
  for (const r of rows) map.set(r.word, toStat(r));
  return map;
}

export function listVocab(): VocabEntry[] {
  const rows = db
    .select()
    .from(schema.vocab)
    .orderBy(desc(schema.vocab.createdAt))
    .all();
  const groups = membershipByWord();
  const stats = statsByWord();
  return rows.map((r) => ({
    ...r,
    groups: groups.get(r.word) ?? [],
    stats: stats.get(r.word) ?? null,
    forms: displayForms(r.display, r.forms),
  }));
}

export function getVocab(word: string): VocabEntry | null {
  const r = db
    .select()
    .from(schema.vocab)
    .where(eq(schema.vocab.word, key(word)))
    .get();
  if (!r) return null;
  const groups = db
    .select()
    .from(schema.vocabGroupMembers)
    .where(eq(schema.vocabGroupMembers.word, r.word))
    .all()
    .map((m) => m.groupId);
  const stat = db
    .select()
    .from(schema.vocabStats)
    .where(eq(schema.vocabStats.word, r.word))
    .get();
  return {
    ...r,
    groups,
    stats: stat ? toStat(stat) : null,
    forms: displayForms(r.display, r.forms),
  };
}

/** Record one flashcard grade for a word; increments the running tally. */
export function recordStudy(word: string, known: boolean): VocabStat {
  const w = key(word);
  db.insert(schema.vocabStats)
    .values({
      word: w,
      known: known ? 1 : 0,
      missed: known ? 0 : 1,
      lastResult: known ? 1 : 0,
      lastStudiedAt: sql`(unixepoch())`,
    })
    .onConflictDoUpdate({
      target: schema.vocabStats.word,
      set: {
        known: sql`${schema.vocabStats.known} + ${known ? 1 : 0}`,
        missed: sql`${schema.vocabStats.missed} + ${known ? 0 : 1}`,
        lastResult: known ? 1 : 0,
        lastStudiedAt: sql`(unixepoch())`,
      },
    })
    .run();
  const row = db
    .select()
    .from(schema.vocabStats)
    .where(eq(schema.vocabStats.word, w))
    .get();
  return toStat(row!);
}

/** Clear a word's flashcard tally. */
export function resetStudy(word: string): void {
  db.delete(schema.vocabStats)
    .where(eq(schema.vocabStats.word, key(word)))
    .run();
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
export function upsertVocab(body: SaveVocabBody): VocabEntry {
  const word = key(body.word);
  const forms = cleanForms(body.forms);
  const row = {
    word,
    display: (body.display ?? body.word).trim(),
    translation: body.translation,
    examples: body.examples,
    forms,
  };
  db.insert(schema.vocab)
    .values(row)
    .onConflictDoUpdate({
      target: schema.vocab.word,
      set: {
        display: row.display,
        translation: row.translation,
        examples: row.examples,
        // Keep existing forms when this save didn't provide any.
        forms: sql`COALESCE(excluded.forms, ${schema.vocab.forms})`,
      },
    })
    .run();
  return getVocab(word)!;
}

export function removeVocab(word: string): void {
  const w = key(word);
  db.delete(schema.vocab).where(eq(schema.vocab.word, w)).run();
  db.delete(schema.vocabGroupMembers)
    .where(eq(schema.vocabGroupMembers.word, w))
    .run();
  db.delete(schema.vocabStats).where(eq(schema.vocabStats.word, w)).run();
}

// --- groups ----------------------------------------------------------------

export function listGroups(): VocabGroup[] {
  return db.all(sql`
    SELECT g.id AS id, g.name AS name, g.created_at AS createdAt,
           (SELECT count(*) FROM vocab_group_members m WHERE m.group_id = g.id) AS count
    FROM vocab_groups g
    ORDER BY g.name COLLATE NOCASE ASC
  `) as VocabGroup[];
}

export function createGroup(name: string): VocabGroup {
  const res = db
    .insert(schema.vocabGroups)
    .values({ name: name.trim() })
    .run();
  const id = Number(res.lastInsertRowid);
  return { id, name: name.trim(), count: 0, createdAt: 0 };
}

export function deleteGroup(id: number): void {
  db.delete(schema.vocabGroups).where(eq(schema.vocabGroups.id, id)).run();
  db.delete(schema.vocabGroupMembers)
    .where(eq(schema.vocabGroupMembers.groupId, id))
    .run();
}

export function addWordToGroup(id: number, word: string): void {
  db.insert(schema.vocabGroupMembers)
    .values({ groupId: id, word: key(word) })
    .onConflictDoNothing()
    .run();
}

export function removeWordFromGroup(id: number, word: string): void {
  db.delete(schema.vocabGroupMembers)
    .where(
      sql`${schema.vocabGroupMembers.groupId} = ${id} AND ${schema.vocabGroupMembers.word} = ${key(word)}`,
    )
    .run();
}
