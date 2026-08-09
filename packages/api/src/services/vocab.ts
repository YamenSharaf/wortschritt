import { desc, eq, sql } from "drizzle-orm";
import type { SaveVocabBody, VocabEntry } from "@mdb/shared";
import { db, schema } from "../db/client";

const key = (w: string) => w.trim().toLowerCase();

export function listVocab(): VocabEntry[] {
  return db
    .select()
    .from(schema.vocab)
    .orderBy(desc(schema.vocab.createdAt))
    .all();
}

export function getVocab(word: string): VocabEntry | null {
  return (
    db.select().from(schema.vocab).where(eq(schema.vocab.word, key(word))).get() ??
    null
  );
}

/** Insert or update by normalized word; preserves the original createdAt. */
export function upsertVocab(body: SaveVocabBody): VocabEntry {
  const word = key(body.word);
  const row = {
    word,
    display: (body.display ?? body.word).trim(),
    translation: body.translation,
    examples: body.examples,
  };
  db.insert(schema.vocab)
    .values(row)
    .onConflictDoUpdate({
      target: schema.vocab.word,
      set: {
        display: row.display,
        translation: row.translation,
        examples: row.examples,
      },
    })
    .run();
  return getVocab(word)!;
}

export function removeVocab(word: string): void {
  db.delete(schema.vocab).where(eq(schema.vocab.word, key(word))).run();
}

export function vocabExists(word: string): boolean {
  const r = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.vocab)
    .where(eq(schema.vocab.word, key(word)))
    .get();
  return (r?.n ?? 0) > 0;
}
