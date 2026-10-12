import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { favorite, favoriteKind } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { favoriteTargetExists, listFavorites, setFavorite } from "../services/favorites";

/** Starred exercise sets and cheat sheets (this learner's own). */
export async function favoritesRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ kind: favoriteKind, id: z.string().min(1) });
  const failure = z.object({ error: z.string() });

  r.get(
    "/api/favorites",
    { preHandler: requireAuth, schema: { tags: ["favorites"], response: { 200: z.array(favorite) } } },
    async (req) => listFavorites(req.user!.id),
  );

  r.put(
    "/api/favorites/:kind/:id",
    { preHandler: requireAuth, schema: { tags: ["favorites"], params, response: { 200: z.array(favorite), 404: failure } } },
    async (req, reply) => {
      if (!favoriteTargetExists(req.params.kind, req.params.id)) return reply.code(404).send({ error: "not found" });
      setFavorite(req.user!.id, req.params.kind, req.params.id, true);
      return listFavorites(req.user!.id);
    },
  );

  r.delete(
    "/api/favorites/:kind/:id",
    { preHandler: requireAuth, schema: { tags: ["favorites"], params, response: { 200: z.array(favorite) } } },
    async (req) => {
      setFavorite(req.user!.id, req.params.kind, req.params.id, false);
      return listFavorites(req.user!.id);
    },
  );
}
