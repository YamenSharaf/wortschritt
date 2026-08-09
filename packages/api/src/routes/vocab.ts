import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { saveVocabBody, vocabEntry } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import {
  getVocab,
  listVocab,
  removeVocab,
  upsertVocab,
} from "../services/vocab";

export async function vocabRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/vocab",
    {
      preHandler: requireAuth,
      schema: { tags: ["vocab"], response: { 200: z.array(vocabEntry) } },
    },
    async () => listVocab(),
  );

  r.get(
    "/api/vocab/:word",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["vocab"],
        params: z.object({ word: z.string().min(1) }),
        response: { 200: vocabEntry.nullable() },
      },
    },
    async (req) => getVocab(req.params.word),
  );

  r.post(
    "/api/vocab",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["vocab"],
        body: saveVocabBody,
        response: { 200: vocabEntry },
      },
    },
    async (req) => upsertVocab(req.body),
  );

  r.delete(
    "/api/vocab/:word",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["vocab"],
        params: z.object({ word: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      removeVocab(req.params.word);
      return { ok: true as const };
    },
  );
}
