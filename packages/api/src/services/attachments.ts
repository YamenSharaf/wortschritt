import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { ATTACHMENT_MAX_BYTES, type NoteAttachment } from "@mdb/shared";
import { db, schema } from "../db/client";
import { env } from "../env";

// The files live on the app's own data volume, one folder per learner.
const root = join(dirname(resolve(env.DATABASE_PATH)), "attachments");
const fileOf = (userId: number, id: string) => join(root, String(userId), id);

export class AttachmentError extends Error {}

const owned = (userId: number, id: string) =>
  and(eq(schema.noteAttachments.userId, userId), eq(schema.noteAttachments.id, id));

function toAttachment(row: typeof schema.noteAttachments.$inferSelect): NoteAttachment {
  return { id: row.id, name: row.name, type: row.type, size: row.size, createdAt: row.createdAt };
}

/** Every attachment of this learner, by note (for listing all notes at once). */
export function attachmentsByNote(userId: number): Map<string, NoteAttachment[]> {
  const out = new Map<string, NoteAttachment[]>();
  const rows = db
    .select()
    .from(schema.noteAttachments)
    .where(eq(schema.noteAttachments.userId, userId))
    .orderBy(asc(schema.noteAttachments.createdAt), asc(schema.noteAttachments.name))
    .all();
  for (const row of rows) {
    const list = out.get(row.noteId) ?? [];
    list.push(toAttachment(row));
    out.set(row.noteId, list);
  }
  return out;
}

export function noteAttachments(userId: number, noteId: string): NoteAttachment[] {
  return db
    .select()
    .from(schema.noteAttachments)
    .where(and(eq(schema.noteAttachments.userId, userId), eq(schema.noteAttachments.noteId, noteId)))
    .orderBy(asc(schema.noteAttachments.createdAt), asc(schema.noteAttachments.name))
    .all()
    .map(toAttachment);
}

/** A file name safe to keep and to send back in a header. */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200);
  return clean || "file";
}

/** A plain media type ("text/plain"), or a generic one if it isn't one. */
export function cleanType(type: string | undefined): string {
  const t = (type ?? "").split(";")[0]!.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(t) ? t : "application/octet-stream";
}

/** Text the assistant can read (and that the app can show as text). */
export const isText = (type: string) =>
  type.startsWith("text/") || type === "application/json" || type === "application/xml";

/** Keep a file with a note. The note must exist and belong to this learner. */
export function addAttachment(
  userId: number,
  noteId: string,
  file: { name: string; type?: string; data: Buffer },
): NoteAttachment {
  const note = db
    .select({ id: schema.notes.id })
    .from(schema.notes)
    .where(and(eq(schema.notes.userId, userId), eq(schema.notes.id, noteId)))
    .get();
  if (!note) throw new AttachmentError("note not found");
  if (file.data.length === 0) throw new AttachmentError("the file is empty");
  if (file.data.length > ATTACHMENT_MAX_BYTES) {
    throw new AttachmentError(`the file is larger than ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB`);
  }
  const id = randomUUID();
  const path = fileOf(userId, id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.data);
  try {
    db.insert(schema.noteAttachments)
      .values({ id, userId, noteId, name: cleanName(file.name), type: cleanType(file.type), size: file.data.length })
      .run();
  } catch (err) {
    rmSync(path, { force: true });
    throw err;
  }
  const row = db.select().from(schema.noteAttachments).where(owned(userId, id)).get()!;
  return toAttachment(row);
}

/** The attachment and where its bytes are, if it's this learner's. */
export function attachmentFile(
  userId: number,
  id: string,
): { attachment: NoteAttachment & { noteId: string }; path: string; size: number } | null {
  const row = db.select().from(schema.noteAttachments).where(owned(userId, id)).get();
  if (!row) return null;
  const path = fileOf(userId, id);
  if (!existsSync(path)) return null;
  return { attachment: { ...toAttachment(row), noteId: row.noteId }, path, size: statSync(path).size };
}

/** The text of a text attachment (null if it isn't one, or doesn't exist). */
export function attachmentText(userId: number, id: string): { attachment: NoteAttachment; text: string } | null {
  const file = attachmentFile(userId, id);
  if (!file || !isText(file.attachment.type)) return null;
  return { attachment: file.attachment, text: readFileSync(file.path, "utf8") };
}

export function removeAttachment(userId: number, id: string): boolean {
  const row = db.select().from(schema.noteAttachments).where(owned(userId, id)).get();
  if (!row) return false;
  db.delete(schema.noteAttachments).where(owned(userId, id)).run();
  rmSync(fileOf(userId, id), { force: true });
  return true;
}

/** Drop everything kept with a note (when the note goes). */
export function removeNoteAttachments(userId: number, noteId: string): void {
  for (const a of noteAttachments(userId, noteId)) removeAttachment(userId, a.id);
}
