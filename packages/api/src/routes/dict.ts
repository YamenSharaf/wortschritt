import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { dictEntry } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { dictAvailable, lookupWord } from "../services/dict";

export async function dictRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Registered before /:word so "status" isn't captured as a word.
  r.get(
    "/api/dict/status",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["dict"],
        response: { 200: z.object({ available: z.boolean() }) },
      },
    },
    async () => ({ available: dictAvailable() }),
  );

  r.get(
    "/api/dict/:word",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["dict"],
        params: z.object({ word: z.string().min(1).max(80) }),
        response: { 200: dictEntry.nullable() },
      },
    },
    async (req) => lookupWord(req.params.word),
  );
}
