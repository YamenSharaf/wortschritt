import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { activityView, mistake, setHistory } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { getActivity, getMistakes, getSetHistory } from "../services/history";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/** The signed-in user's practice history (mistakes, timeline, per-set runs). */
export async function historyRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/history/mistakes",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["history"],
        querystring: z.object({
          setId: z.string().min(1).optional(),
          /** Only mistakes from the last N days. */
          days: z.coerce.number().int().min(1).max(3650).optional(),
          /** Also items answered correctly since. */
          includeResolved: z
            .enum(["true", "false"])
            .optional()
            .transform((v) => v === "true"),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.array(mistake) },
      },
    },
    async (req) =>
      getMistakes(req.user!.id, {
        setId: req.query.setId,
        since: req.query.days ? Math.floor(Date.now() / 1000) - req.query.days * 86400 : undefined,
        includeResolved: req.query.includeResolved,
        limit: req.query.limit,
      }),
  );

  r.get(
    "/api/history/activity",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["history"],
        querystring: z.object({ from: date.optional(), to: date.optional() }),
        response: { 200: activityView },
      },
    },
    async (req) => getActivity(req.user!.id, req.query),
  );

  r.get(
    "/api/history/sets/:setId",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["history"],
        params: z.object({ setId: z.string().min(1) }),
        response: { 200: setHistory },
      },
    },
    async (req) => getSetHistory(req.user!.id, req.params.setId),
  );
}
