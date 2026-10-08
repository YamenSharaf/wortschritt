import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { APP_NAME, apiVersion } from "@mdb/shared";
import { env } from "../env";

/**
 * What the native app needs from the server before signing in:
 * - CORS for its built-in pages' origin (capacitor://localhost …) on /api,
 *   bearer tokens only — credentials (cookies) are never allowed;
 * - GET /api/version, so it can tell the user to update the app (or the
 *   server) when they're too far apart.
 */
const API_VERSION = 1;
const MIN_CLIENT = 1;

export async function nativeRoutes(app: FastifyInstance) {
  const allowed = new Set(
    env.APP_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) return;
    reply.header("access-control-allow-origin", origin).header("vary", "Origin");
    if (req.method === "OPTIONS") {
      return reply
        .header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        .header("access-control-allow-headers", "authorization, content-type")
        .header("access-control-max-age", "600")
        .code(204)
        .send();
    }
  });
  // Preflights need a route to land on.
  app.options("/api/*", { schema: { hide: true } }, async (_req, reply) => reply.code(204).send());

  app.withTypeProvider<ZodTypeProvider>().get(
    "/api/version",
    { schema: { tags: ["config"], response: { 200: apiVersion } } },
    async () => ({ api: API_VERSION, minClient: MIN_CLIENT, appName: APP_NAME }),
  );
}
