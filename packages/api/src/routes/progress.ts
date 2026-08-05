import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { attemptBody, progressSummary } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { getProgressSummary, recordAttempt } from "../services/progress";

export async function progressRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/attempts",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["progress"],
        body: attemptBody,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      recordAttempt(req.body);
      return { ok: true as const };
    },
  );

  r.get(
    "/api/progress",
    {
      preHandler: requireAuth,
      schema: { tags: ["progress"], response: { 200: progressSummary } },
    },
    async () => getProgressSummary(),
  );
}
