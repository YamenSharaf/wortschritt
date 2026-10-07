import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { dictEntry, lemmasBody, lemmasResult, wordDetails as wordDetailsDto } from "@mdb/shared";
import { clientIp } from "../auth/loginGuard";
import { requireAuth } from "../auth/session";
import { dictAvailable, lookupWord } from "../services/dict";
import { wordDetails } from "../services/wiktionary";

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

  // Base forms of many words at once (e.g. to underline saved words in a
  // story even when they're inflected). Unknown words are left out.
  r.post(
    "/api/dict/lemmas",
    {
      preHandler: requireAuth,
      schema: { tags: ["dict"], body: lemmasBody, response: { 200: lemmasResult } },
    },
    async (req) => {
      const out: Record<string, string> = {};
      for (const w of new Set(req.body.words)) {
        const lemma = lookupWord(w)?.lemma;
        if (lemma) out[w] = lemma;
      }
      return out;
    },
  );

  // Wiktionary details (definitions, IPA, examples) for the tap popup, loaded
  // after the offline gloss. Looks up the offline base form first.
  r.get(
    "/api/dict/:word/details",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 90, timeWindow: "1 minute", keyGenerator: clientIp } },
      schema: {
        tags: ["dict"],
        params: z.object({ word: z.string().min(1).max(64) }),
        response: { 200: wordDetailsDto.nullable() },
      },
    },
    async (req) => {
      const surface = req.params.word.trim();
      return wordDetails([lookupWord(surface)?.lemma ?? surface, surface]);
    },
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
