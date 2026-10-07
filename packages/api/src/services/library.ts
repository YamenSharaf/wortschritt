import { desc, eq } from "drizzle-orm";
import type { ImportBody, ImportedItem } from "@mdb/shared";
import type { AuthUser } from "../auth/users";
import { builtInIds } from "../content/loader";
import { db, schema } from "../db/client";

/**
 * The shared library's imported content. Anyone signed in can add to it; an
 * import can only be replaced or deleted by whoever imported it, or an admin,
 * and only an admin may shadow a built-in (git) item by reusing its id.
 * Used by the REST routes and the MCP server alike.
 */

type Failure = { ok: false; status: 403 | 404 | 409; error: string };

function owner(id: string) {
  return db
    .select({ createdBy: schema.importedContent.createdBy })
    .from(schema.importedContent)
    .where(eq(schema.importedContent.id, id))
    .get();
}

export function saveImport(
  user: AuthUser,
  { kind, data }: ImportBody,
  { overwrite = true }: { overwrite?: boolean } = {},
): { ok: true; id: string; kind: ImportBody["kind"]; replaced: boolean } | Failure {
  const isAdmin = user.role === "admin";
  const existing = owner(data.id);
  if (existing && existing.createdBy !== user.id && !isAdmin) {
    return { ok: false, status: 403, error: `"${data.id}" was imported by someone else; choose a different id` };
  }
  if (!existing && !isAdmin && builtInIds(kind).has(data.id)) {
    return { ok: false, status: 409, error: `"${data.id}" is built-in content; choose a different id` };
  }
  if (existing && !overwrite) {
    return { ok: false, status: 409, error: `"${data.id}" already exists; choose a different id or pass overwrite: true to replace it` };
  }
  db.insert(schema.importedContent)
    .values({ id: data.id, kind, data, createdBy: user.id })
    .onConflictDoUpdate({
      target: schema.importedContent.id,
      // The original importer stays the owner, even when the admin edits it.
      set: { kind, data },
    })
    .run();
  return { ok: true, id: data.id, kind, replaced: !!existing };
}

/** Imports, newest first (built-in files aren't listed: they can't be deleted). */
export function listImports(user: AuthUser): ImportedItem[] {
  return db
    .select({
      id: schema.importedContent.id,
      kind: schema.importedContent.kind,
      data: schema.importedContent.data,
      createdAt: schema.importedContent.createdAt,
      createdById: schema.importedContent.createdBy,
      createdBy: schema.users.username,
    })
    .from(schema.importedContent)
    .leftJoin(schema.users, eq(schema.users.id, schema.importedContent.createdBy))
    .orderBy(desc(schema.importedContent.createdAt))
    .all()
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      title: String((r.data as { title?: unknown })?.title ?? r.id),
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy ?? null,
      canDelete: user.role === "admin" || r.createdById === user.id,
    }));
}

/** Delete an import: its importer or an admin. Learners' progress on it stays
 *  in their history; the item just disappears from the library. */
export function deleteImport(user: AuthUser, id: string): { ok: true } | Failure {
  const row = owner(id);
  if (!row) return { ok: false, status: 404, error: "no such import" };
  if (user.role !== "admin" && row.createdBy !== user.id) {
    return { ok: false, status: 403, error: "only its importer or an admin can delete it" };
  }
  db.delete(schema.importedContent).where(eq(schema.importedContent.id, id)).run();
  return { ok: true };
}
