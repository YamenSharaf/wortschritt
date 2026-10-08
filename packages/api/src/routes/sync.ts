import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { syncChanges as syncChangesDto, syncChangesQuery, syncPushBody, syncPushResult } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { syncChanges, syncPush } from "../services/sync";

/** Offline sync for the native app (see services/sync.ts). Per user, like everything private. */
export async function syncRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/sync/changes",
    { preHandler: requireAuth, schema: { tags: ["sync"], querystring: syncChangesQuery, response: { 200: syncChangesDto } } },
    async (req) => syncChanges(req.user!.id, req.query.since === undefined ? null : Number(req.query.since), req.query.library),
  );

  r.post(
    "/api/sync/push",
    { preHandler: requireAuth, schema: { tags: ["sync"], body: syncPushBody, response: { 200: syncPushResult } } },
    async (req) => syncPush(req.user!.id, req.body.ops),
  );
}
