import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { answerBody, answerVerdict, progressSummary } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { answer, AnswerError } from "../services/answers";
import { getProgressSummary } from "../services/progress";

export async function progressRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/answers",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["progress"],
        description: "Answer one item: the server grades it (with the AI tutor for a free-text miss when AI grading is on), records it and adds it to the set's session.",
        body: answerBody,
        response: { 200: answerVerdict, 404: z.object({ error: z.string() }) },
      },
    },
    async (req, reply) => {
      try {
        return await answer(req.user!.id, req.body, req.log);
      } catch (err) {
        if (err instanceof AnswerError) return reply.code(404).send({ error: err.message });
        throw err;
      }
    },
  );

  r.get(
    "/api/progress",
    {
      preHandler: requireAuth,
      schema: { tags: ["progress"], response: { 200: progressSummary } },
    },
    async (req) => getProgressSummary(req.user!.id),
  );
}
