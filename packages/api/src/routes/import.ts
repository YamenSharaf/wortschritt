import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { importBody, importedItem } from "@mdb/shared";
import { desc, eq } from "drizzle-orm";
import { requireAuth } from "../auth/session";
import { builtInIds } from "../content/loader";
import { db, schema } from "../db/client";

export async function importRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Validate LLM-generated (or hand-written) JSON against the shared schemas
   * and store it. The `importBody` discriminated union does the validation, so
   * malformed content is rejected with a 400 before it ever touches the DB.
   *
   * The library is shared, so ids are guarded: an import can only be replaced
   * by whoever imported it (or the admin), and only the admin may shadow a
   * built-in (git) item by reusing its id.
   */
  r.post(
    "/api/import",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["import"],
        body: importBody,
        response: {
          200: z.object({ ok: z.literal(true), id: z.string(), kind: z.string() }),
          403: z.object({ error: z.string() }),
          409: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { kind, data } = req.body;
      const user = req.user!;
      const isAdmin = user.role === "admin";
      const existing = db
        .select({ createdBy: schema.importedContent.createdBy })
        .from(schema.importedContent)
        .where(eq(schema.importedContent.id, data.id))
        .get();
      if (existing && existing.createdBy !== user.id && !isAdmin) {
        return reply
          .code(403)
          .send({ error: `"${data.id}" was imported by someone else; choose a different id` });
      }
      if (!existing && !isAdmin && builtInIds(kind).has(data.id)) {
        return reply
          .code(409)
          .send({ error: `"${data.id}" is built-in content; choose a different id` });
      }
      db.insert(schema.importedContent)
        .values({ id: data.id, kind, data, createdBy: user.id })
        .onConflictDoUpdate({
          target: schema.importedContent.id,
          // The original importer stays the owner, even when the admin edits it.
          set: { kind, data },
        })
        .run();
      return { ok: true as const, id: data.id, kind };
    },
  );

  // The shared library's imports (built-in files aren't listed: they can't be
  // deleted from the app).
  r.get(
    "/api/imports",
    {
      preHandler: requireAuth,
      schema: { tags: ["import"], response: { 200: z.array(importedItem) } },
    },
    async (req) => {
      const user = req.user!;
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
    },
  );

  // Delete an import: its importer or an admin. Learners' progress on it stays
  // in their history; the set just disappears from the library.
  r.delete(
    "/api/imports/:id",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["import"],
        params: z.object({ id: z.string().min(1) }),
        response: {
          200: z.object({ ok: z.literal(true) }),
          403: z.object({ error: z.string() }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const row = db
        .select({ createdBy: schema.importedContent.createdBy })
        .from(schema.importedContent)
        .where(eq(schema.importedContent.id, req.params.id))
        .get();
      if (!row) return reply.code(404).send({ error: "no such import" });
      if (req.user!.role !== "admin" && row.createdBy !== req.user!.id) {
        return reply.code(403).send({ error: "only its importer or an admin can delete it" });
      }
      db.delete(schema.importedContent).where(eq(schema.importedContent.id, req.params.id)).run();
      req.log.info({ id: req.params.id, by: req.user!.username }, "import deleted");
      return { ok: true as const };
    },
  );
}
