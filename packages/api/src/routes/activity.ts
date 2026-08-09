import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  exerciseRun,
  recordRunBody,
  runSummary,
  sheetView,
  sheetViewBody,
} from "@mdb/shared";
import { requireAuth } from "../auth/session";
import {
  latestRunForSet,
  latestRunsPerSet,
  recentSheetViews,
  recordRun,
  recordSheetView,
} from "../services/activity";

export async function activityRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/runs",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["activity"],
        body: recordRunBody,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      recordRun(req.body);
      return { ok: true as const };
    },
  );

  r.get(
    "/api/runs",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["activity"],
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }),
        response: { 200: z.array(runSummary) },
      },
    },
    async (req) => latestRunsPerSet(req.query.limit),
  );

  r.get(
    "/api/runs/:setId",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["activity"],
        params: z.object({ setId: z.string().min(1) }),
        response: { 200: exerciseRun.nullable() },
      },
    },
    async (req) => latestRunForSet(req.params.setId),
  );

  r.post(
    "/api/sheet-views",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["activity"],
        body: sheetViewBody,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      recordSheetView(req.body);
      return { ok: true as const };
    },
  );

  r.get(
    "/api/sheet-views",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["activity"],
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }),
        response: { 200: z.array(sheetView) },
      },
    },
    async (req) => recentSheetViews(req.query.limit),
  );
}
