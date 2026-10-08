import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { seedAdminAiFromEnv } from "./assistant/config";
import { pruneOAuth } from "./auth/oauth";
import { pruneExpiredSessions, requireAuth } from "./auth/session";
import { ensureAdminUser } from "./auth/users";
import { ensureSchema } from "./db/client";
import { seedDictionary } from "./db/dictSeed";
import { env, isProd } from "./env";
import { activityRoutes } from "./routes/activity";
import { adminRoutes } from "./routes/admin";
import { assistantRoutes } from "./routes/assistant";
import { authRoutes } from "./routes/auth";
import { contentRoutes } from "./routes/content";
import { dictRoutes } from "./routes/dict";
import { historyRoutes } from "./routes/history";
import { importRoutes } from "./routes/import";
import { mcpRoutes } from "./routes/mcp";
import { oauthRoutes } from "./routes/oauth";
import { notesRoutes } from "./routes/notes";
import { progressRoutes } from "./routes/progress";
import { seriesRoutes } from "./routes/series";
import { coverRoutes } from "./routes/covers";
import { nativeRoutes } from "./routes/native";
import { syncRoutes } from "./routes/sync";
import { pruneSync } from "./services/sync";
import { settingsRoutes } from "./routes/settings";
import { storyRoutes } from "./routes/stories";
import { ttsRoutes } from "./routes/tts";
import { vocabRoutes } from "./routes/vocab";

export async function buildApp(): Promise<FastifyInstance> {
  const migration = ensureSchema();

  const app = Fastify({
    logger: {
      level: isProd ? "info" : env.NODE_ENV === "test" ? "silent" : "debug",
    },
  });
  if (migration.to !== migration.from) {
    app.log.info(migration, "database schema migrated");
  }

  await ensureAdminUser(app.log);
  seedAdminAiFromEnv(app.log);
  const prune = () => {
    pruneExpiredSessions();
    pruneOAuth();
    pruneSync();
  };
  prune();
  setInterval(prune, 60 * 60 * 1000).unref();

  // Load the bundled offline dictionary into SQLite once (idempotent).
  seedDictionary(app.log);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie, { secret: env.SESSION_SECRET });
  // Opt-in per route via `config.rateLimit` (the auth routes).
  await app.register(rateLimit, { global: false });
  app.decorateRequest("user", null);
  app.decorateRequest("authVia", null);
  // Nothing here is meant to be framed (the OAuth consent page in particular).
  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-frame-options", "DENY");
    // A route may set a stricter policy (cover images do); keep it, adding framing.
    const csp = reply.getHeader("content-security-policy");
    reply.header("content-security-policy", csp ? `${String(csp)}; frame-ancestors 'none'` : "frame-ancestors 'none'");
  });

  await app.register(swagger, {
    openapi: {
      info: { title: "Wortschritt API", version: "0.1.0" },
      components: {
        securitySchemes: {
          // Personal API tokens (Settings → Connections → API tokens).
          bearer: { type: "http", scheme: "bearer" },
        },
      },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  // The docs (UI and JSON spec) require a signed-in session or an API token.
  await app.register(swaggerUi, {
    routePrefix: "/api/docs",
    uiHooks: { onRequest: requireAuth },
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  // On the root instance (not a plugin), so its CORS hook covers every /api route.
  await nativeRoutes(app);
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(contentRoutes);
  await app.register(progressRoutes);
  await app.register(activityRoutes);
  await app.register(historyRoutes);
  await app.register(vocabRoutes);
  await app.register(ttsRoutes);
  await app.register(settingsRoutes);
  await app.register(importRoutes);
  await app.register(notesRoutes);
  await app.register(storyRoutes);
  await app.register(seriesRoutes);
  await app.register(coverRoutes);
  await app.register(syncRoutes);
  await app.register(dictRoutes);
  await app.register(assistantRoutes);
  await app.register(mcpRoutes);
  await app.register(oauthRoutes);

  // In production, serve the built SPA from the same container/origin.
  const webDist = resolve(process.cwd(), "../web/dist");
  if (isProd && existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      // Take full control of Cache-Control below (the plugin otherwise forces
      // `public, max-age=0` on everything). ETag/Last-Modified stay on.
      cacheControl: false,
      setHeaders(res, path) {
        // Vite emits content-hashed files under /assets — their URL changes on
        // every build, so they're safe to cache forever. index.html is the
        // pointer to the current bundle, so it must always be revalidated;
        // otherwise a stale index.html keeps loading yesterday's JS even after
        // the container updates. `no-cache` = store but revalidate (ETag → 304).
        if (path.includes("/assets/")) {
          res.setHeader("cache-control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("cache-control", "no-cache");
        }
      },
    });
    // SPA fallback: any non-API GET returns index.html so client routing works.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api")) {
        return reply.header("cache-control", "no-cache").sendFile("index.html");
      }
      return reply.code(404).send({ error: "not found" });
    });
  }

  return app;
}
