import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  exerciseProgress,
  exerciseRun,
  recordRunBody,
  runSummary,
  saveExerciseProgressBody,
  sheetView,
  sheetViewBody,
} from "@mdb/shared";
import { requireAuth } from "../auth/session";
import {
  clearExerciseProgress,
  getExerciseProgress,
  latestRunForSet,
  latestRunsPerSet,
  recentSheetViews,
  recordRun,
  recordSheetView,
  saveExerciseProgress,
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
      recordRun(req.user!.id, req.body);
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
    async (req) => latestRunsPerSet(req.user!.id, req.query.limit),
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
    async (req) => latestRunForSet(req.user!.id, req.params.setId),
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
      recordSheetView(req.user!.id, req.body);
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
    async (req) => recentSheetViews(req.user!.id, req.query.limit),
  );

  // Resumable in-progress position within an exercise set.
  r.get(
    "/api/exercise-progress/:setId",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["activity"],
        params: z.object({ setId: z.string().min(1) }),
        response: { 200: exerciseProgress.nullable() },
      },
    },
    async (req) => getExerciseProgress(req.user!.id, req.params.setId),
  );

  r.put(
    "/api/exercise-progress/:setId",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["activity"],
        params: z.object({ setId: z.string().min(1) }),
        body: saveExerciseProgressBody,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      saveExerciseProgress(req.user!.id, req.params.setId, req.body);
      return { ok: true as const };
    },
  );

  r.delete(
    "/api/exercise-progress/:setId",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["activity"],
        params: z.object({ setId: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      clearExerciseProgress(req.user!.id, req.params.setId);
      return { ok: true as const };
    },
  );
}
