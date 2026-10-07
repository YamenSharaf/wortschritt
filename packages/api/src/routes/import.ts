import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { importBody, importedItem } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { deleteImport, listImports, saveImport } from "../services/library";

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
      const res = saveImport(req.user!, req.body);
      if (!res.ok) return reply.code(res.status as 403 | 409).send({ error: res.error });
      return { ok: true as const, id: res.id, kind: res.kind };
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
    async (req) => listImports(req.user!),
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
      const res = deleteImport(req.user!, req.params.id);
      if (!res.ok) return reply.code(res.status as 403 | 404).send({ error: res.error });
      req.log.info({ id: req.params.id, by: req.user!.username }, "import deleted");
      return { ok: true as const };
    },
  );
}
