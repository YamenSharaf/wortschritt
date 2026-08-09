import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { ensureSchema } from "./db/client";
import { env, isProd } from "./env";
import { activityRoutes } from "./routes/activity";
import { assistantRoutes } from "./routes/assistant";
import { authRoutes } from "./routes/auth";
import { configRoutes } from "./routes/config";
import { contentRoutes } from "./routes/content";
import { importRoutes } from "./routes/import";
import { progressRoutes } from "./routes/progress";
import { settingsRoutes } from "./routes/settings";
import { vocabRoutes } from "./routes/vocab";

export async function buildApp(): Promise<FastifyInstance> {
  ensureSchema();

  const app = Fastify({
    logger: { level: isProd ? "info" : "debug" },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie, { secret: env.SESSION_SECRET });

  await app.register(swagger, {
    openapi: {
      info: { title: "mit-dem-baby API", version: "0.1.0" },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(configRoutes);
  await app.register(authRoutes);
  await app.register(contentRoutes);
  await app.register(progressRoutes);
  await app.register(activityRoutes);
  await app.register(vocabRoutes);
  await app.register(settingsRoutes);
  await app.register(importRoutes);
  await app.register(assistantRoutes);

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
