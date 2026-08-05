import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { loginBody } from "@mdb/shared";
import {
  clearSession,
  isAuthenticated,
  startSession,
  verifyPassword,
} from "../auth/session";

export async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/auth/login",
    {
      schema: {
        tags: ["auth"],
        body: loginBody,
        response: {
          200: z.object({ ok: z.literal(true) }),
          401: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      if (!verifyPassword(req.body.password)) {
        return reply.code(401).send({ error: "invalid password" });
      }
      startSession(reply);
      return { ok: true as const };
    },
  );

  r.post(
    "/api/auth/logout",
    { schema: { tags: ["auth"], response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (_req, reply) => {
      clearSession(reply);
      return { ok: true as const };
    },
  );

  r.get(
    "/api/auth/me",
    {
      schema: {
        tags: ["auth"],
        response: { 200: z.object({ authenticated: z.boolean() }) },
      },
    },
    async (req) => ({ authenticated: isAuthenticated(req) }),
  );
}
