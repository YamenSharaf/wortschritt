import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { importBody } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { db, schema } from "../db/client";

export async function importRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Validate LLM-generated (or hand-written) JSON against the shared schemas
   * and store it. The `importBody` discriminated union does the validation, so
   * malformed content is rejected with a 400 before it ever touches the DB.
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
        },
      },
    },
    async (req) => {
      const { kind, data } = req.body;
      db.insert(schema.importedContent)
        .values({ id: data.id, kind, data })
        .onConflictDoUpdate({
          target: schema.importedContent.id,
          set: { kind, data },
        })
        .run();
      return { ok: true as const, id: data.id, kind };
    },
  );
}
