import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { importBody } from "@mdb/shared";
import { eq } from "drizzle-orm";
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
}
