import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { cheatsheet, EXERCISE_TYPES, exerciseItem, exerciseSet, generateMoreBody, generateMoreResult } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { loadCheatsheets, loadExerciseSets } from "../content/loader";
import { allGenerated, generateMore, GenerateError, listGenerated, removeGenerated, removeGeneratedItem } from "../services/generated";

export async function contentRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/exercise-types",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["content"],
        response: { 200: z.object({ types: z.array(z.string()) }) },
      },
    },
    async () => ({ types: [...EXERCISE_TYPES] }),
  );

  r.get(
    "/api/exercises",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["content"],
        response: { 200: z.array(exerciseSet) },
      },
    },
    async () => loadExerciseSets(),
  );

  r.get(
    "/api/exercises/:id",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["content"],
        params: z.object({ id: z.string() }),
        response: {
          200: exerciseSet,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const set = loadExerciseSets().find((s) => s.id === req.params.id);
      if (!set) return reply.code(404).send({ error: "not found" });
      return set;
    },
  );

  const exists = (id: string) => loadExerciseSets().some((s) => s.id === id);
  const failure = z.object({ error: z.string() });

  // How many generated items this learner has per set (for the sets' item counts).
  r.get(
    "/api/exercises/generated-counts",
    {
      preHandler: requireAuth,
      schema: { tags: ["content"], response: { 200: z.record(z.string(), z.number().int()) } },
    },
    async (req) => Object.fromEntries([...allGenerated(req.user!.id)].map(([setId, items]) => [setId, items.length])),
  );

  // This learner's generated items for a set (they follow the set's own).
  r.get(
    "/api/exercises/:id/generated",
    {
      preHandler: requireAuth,
      schema: { tags: ["content"], params: z.object({ id: z.string() }), response: { 200: z.array(exerciseItem), 404: failure } },
    },
    async (req, reply) =>
      exists(req.params.id) ? listGenerated(req.user!.id, req.params.id) : reply.code(404).send({ error: "not found" }),
  );

  r.post(
    "/api/exercises/:id/generate",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["content"],
        description: "Write more items for this set with the learner's AI tutor (preferring their mistakes as examples) and keep them for this learner.",
        params: z.object({ id: z.string() }),
        body: generateMoreBody,
        response: { 200: generateMoreResult, 404: failure, 502: failure, 503: failure },
      },
    },
    async (req, reply) => {
      try {
        return await generateMore(req.user!.id, req.params.id, req.body.count, req.log);
      } catch (err) {
        if (err instanceof GenerateError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  r.delete(
    "/api/exercises/:id/generated",
    {
      preHandler: requireAuth,
      schema: { tags: ["content"], params: z.object({ id: z.string() }), response: { 200: z.object({ removed: z.number().int() }) } },
    },
    async (req) => ({ removed: removeGenerated(req.user!.id, req.params.id) }),
  );

  r.delete(
    "/api/exercises/:id/generated/:itemId",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["content"],
        description: "Remove one of this learner's generated items from the set.",
        params: z.object({ id: z.string(), itemId: z.string() }),
        response: { 200: z.object({ removed: z.number().int() }) },
      },
    },
    async (req) => ({ removed: removeGeneratedItem(req.user!.id, req.params.id, req.params.itemId) ? 1 : 0 }),
  );

  r.get(
    "/api/cheatsheets",
    {
      preHandler: requireAuth,
      schema: { tags: ["content"], response: { 200: z.array(cheatsheet) } },
    },
    async () => loadCheatsheets(),
  );

  r.get(
    "/api/cheatsheets/:id",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["content"],
        params: z.object({ id: z.string() }),
        response: {
          200: cheatsheet,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const sheet = loadCheatsheets().find((s) => s.id === req.params.id);
      if (!sheet) return reply.code(404).send({ error: "not found" });
      return sheet;
    },
  );
}
