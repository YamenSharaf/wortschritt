import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { CreateNoteBody, Note, SaveNoteBody } from "@mdb/shared";
import { db, schema } from "../db/client";

export function listNotes(): Note[] {
  return db
    .select()
    .from(schema.notes)
    .orderBy(desc(schema.notes.updatedAt))
    .all();
}

export function getNote(id: string): Note | null {
  return (
    db.select().from(schema.notes).where(eq(schema.notes.id, id)).get() ?? null
  );
}

export function createNote(body: CreateNoteBody): Note {
  const id = randomUUID();
  db.insert(schema.notes)
    .values({ id, title: body.title, category: body.category, body: body.body })
    .run();
  return getNote(id)!;
}

/** Patch whichever fields were sent; always bumps updatedAt. Returns null if
 *  the note doesn't exist. */
export function updateNote(id: string, body: SaveNoteBody): Note | null {
  if (!getNote(id)) return null;
  const set: Record<string, unknown> = { updatedAt: sql`(unixepoch())` };
  if (body.title !== undefined) set.title = body.title;
  if (body.category !== undefined) set.category = body.category;
  if (body.body !== undefined) set.body = body.body;
  db.update(schema.notes).set(set).where(eq(schema.notes.id, id)).run();
  return getNote(id);
}

export function removeNote(id: string): void {
  db.delete(schema.notes).where(eq(schema.notes.id, id)).run();
}
