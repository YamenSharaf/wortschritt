import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { cheatsheet, EXERCISE_TYPES, exerciseSet } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { loadCheatsheets, loadExerciseSets } from "../content/loader";

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
