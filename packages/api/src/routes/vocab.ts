import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createGroupBody,
  groupWordBody,
  saveVocabBody,
  vocabEntry,
  vocabGroup,
} from "@mdb/shared";
import { requireAuth } from "../auth/session";
import {
  addWordToGroup,
  createGroup,
  deleteGroup,
  getVocab,
  listGroups,
  listVocab,
  removeVocab,
  removeWordFromGroup,
  upsertVocab,
} from "../services/vocab";

const ok = z.object({ ok: z.literal(true) });

export async function vocabRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // --- groups (registered before /api/vocab/:word to avoid capture) ---------
  r.get(
    "/api/vocab-groups",
    {
      preHandler: requireAuth,
      schema: { tags: ["vocab"], response: { 200: z.array(vocabGroup) } },
    },
    async () => listGroups(),
  );

  r.post(
    "/api/vocab-groups",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["vocab"],
        body: createGroupBody,
        response: { 200: vocabGroup },
      },
    },
    async (req) => createGroup(req.body.name),
  );

  r.delete(
    "/api/vocab-groups/:id",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["vocab"],
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: ok },
      },
    },
    async (req) => {
      deleteGroup(req.params.id);
      return { ok: true as const };
    },
  );

  r.post(
    "/api/vocab-groups/:id/words",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["vocab"],
        params: z.object({ id: z.coerce.number().int() }),
        body: groupWordBody,
        response: { 200: ok },
      },
    },
    async (req) => {
      addWordToGroup(req.params.id, req.body.word);
      return { ok: true as const };
    },
  );

  r.delete(
    "/api/vocab-groups/:id/words/:word",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["vocab"],
        params: z.object({
          id: z.coerce.number().int(),
          word: z.string().min(1),
        }),
        response: { 200: ok },
      },
    },
    async (req) => {
      removeWordFromGroup(req.params.id, req.params.word);
      return { ok: true as const };
    },
  );

  // --- words ----------------------------------------------------------------
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
        response: { 200: ok },
      },
    },
    async (req) => {
      removeVocab(req.params.word);
      return { ok: true as const };
    },
  );
}
