import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { saveStoryBody, story, storyProgressBody, storySummary, storyView } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import {
  deleteStory,
  getStory,
  listStories,
  saveStory,
  setStoryProgress,
  updateStory,
} from "../services/stories";

const ok = z.object({ ok: z.literal(true) });
const failure = z.object({ error: z.string() });
const params = z.object({ id: z.string().min(1) });

/** The signed-in learner's stories (private). */
export async function storyRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/stories",
    { preHandler: requireAuth, schema: { tags: ["stories"], response: { 200: z.array(storySummary) } } },
    async (req) => listStories(req.user!.id),
  );

  r.get(
    "/api/stories/:id",
    {
      preHandler: requireAuth,
      schema: { tags: ["stories"], params, response: { 200: storyView, 404: failure } },
    },
    async (req, reply) => getStory(req.user!.id, req.params.id) ?? reply.code(404).send({ error: "no such story" }),
  );

  r.post(
    "/api/stories",
    {
      preHandler: requireAuth,
      schema: { tags: ["stories"], body: saveStoryBody, response: { 200: storyView, 409: failure } },
    },
    async (req, reply) => {
      const res = saveStory(req.user!.id, req.body.story, { overwrite: req.body.overwrite });
      return res.ok ? res.view : reply.code(409).send({ error: res.error });
    },
  );

  r.put(
    "/api/stories/:id",
    {
      preHandler: requireAuth,
      schema: { tags: ["stories"], params, body: story, response: { 200: storyView, 400: failure, 404: failure } },
    },
    async (req, reply) => {
      if (req.body.id !== req.params.id) {
        return reply.code(400).send({ error: "the story's id can't be changed" });
      }
      return updateStory(req.user!.id, req.params.id, req.body) ?? reply.code(404).send({ error: "no such story" });
    },
  );

  r.delete(
    "/api/stories/:id",
    { preHandler: requireAuth, schema: { tags: ["stories"], params, response: { 200: ok, 404: failure } } },
    async (req, reply) =>
      deleteStory(req.user!.id, req.params.id) ? { ok: true as const } : reply.code(404).send({ error: "no such story" }),
  );

  r.put(
    "/api/stories/:id/progress",
    {
      preHandler: requireAuth,
      schema: { tags: ["stories"], params, body: storyProgressBody, response: { 200: ok, 404: failure } },
    },
    async (req, reply) =>
      setStoryProgress(req.user!.id, req.params.id, req.body.progress, req.body.read)
        ? { ok: true as const }
        : reply.code(404).send({ error: "no such story" }),
  );
}
