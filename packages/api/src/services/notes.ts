import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { CreateNoteBody, Note, SaveNoteBody } from "@mdb/shared";
import { db, schema } from "../db/client";
import { attachmentsByNote, noteAttachments, removeNoteAttachments } from "./attachments";

/** Notes are private: every query is scoped to the owner. */
const owned = (userId: number, id: string) =>
  and(eq(schema.notes.userId, userId), eq(schema.notes.id, id));

/** Strip the owner column from API results, and add the note's files. */
function toNote(
  { userId: _owner, ...note }: typeof schema.notes.$inferSelect,
  attachments: Note["attachments"] = [],
): Note {
  return { ...note, attachments };
}

export function listNotes(userId: number): Note[] {
  const files = attachmentsByNote(userId);
  return db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.userId, userId))
    .orderBy(desc(schema.notes.updatedAt))
    .all()
    .map((row) => toNote(row, files.get(row.id)));
}

export function getNote(userId: number, id: string): Note | null {
  const row = db.select().from(schema.notes).where(owned(userId, id)).get();
  return row ? toNote(row, noteAttachments(userId, id)) : null;
}

export function createNote(userId: number, body: CreateNoteBody): Note {
  const id = randomUUID();
  db.insert(schema.notes)
    .values({ id, userId, title: body.title, category: body.category, body: body.body })
    .run();
  return getNote(userId, id)!;
}

/** Patch whichever fields were sent; always bumps updatedAt. Returns null if
 *  the note doesn't exist. */
export function updateNote(userId: number, id: string, body: SaveNoteBody): Note | null {
  if (!getNote(userId, id)) return null;
  const set: Record<string, unknown> = { updatedAt: sql`(unixepoch())` };
  if (body.title !== undefined) set.title = body.title;
  if (body.category !== undefined) set.category = body.category;
  if (body.body !== undefined) set.body = body.body;
  db.update(schema.notes).set(set).where(owned(userId, id)).run();
  return getNote(userId, id);
}

export function removeNote(userId: number, id: string): void {
  removeNoteAttachments(userId, id);
  db.delete(schema.notes).where(owned(userId, id)).run();
}
