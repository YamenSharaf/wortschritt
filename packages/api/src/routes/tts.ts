import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { TTS_VOICE_CATALOG, TTS_VOICE_IDS, ttsStatus } from "@mdb/shared";
import { requireAdmin, requireAuth } from "../auth/session";
import { env, isTtsEnabled } from "../env";

const base = env.TTS_URL ? env.TTS_URL.replace(/\/$/, "") : null;
// Cache synthesized clips on the app's own data volume (no sharing needed).
const cacheDir = join(dirname(resolve(env.DATABASE_PATH)), "tts-cache");

/** Ask Piper which voices it has (GET /voices → { "<id>": {config}, … }). */
async function installedVoices(): Promise<string[]> {
  if (!base) return [];
  try {
    const res = await fetch(`${base}/voices`);
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    if (Array.isArray(json)) {
      return json
        .map((v) =>
          typeof v === "string" ? v : ((v as { key?: string })?.key ?? ""),
        )
        .filter(Boolean);
    }
    if (json && typeof json === "object") return Object.keys(json);
    return [];
  } catch {
    return [];
  }
}

export async function ttsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/tts/status",
    {
      preHandler: requireAuth,
      schema: { tags: ["tts"], response: { 200: ttsStatus } },
    },
    async () => ({
      available: isTtsEnabled,
      installed: await installedVoices(),
      catalog: TTS_VOICE_CATALOG.map((v) => ({ id: v.id, label: v.label })),
    }),
  );

  // Synthesize (or serve a cached clip). GET so an <audio> element can play it
  // directly; the session cookie authenticates the request.
  r.get(
    "/api/tts",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["tts"],
        querystring: z.object({
          text: z.string().min(1).max(500),
          voice: z.string().min(1),
        }),
      },
    },
    async (req, reply) => {
      if (!base) return reply.code(503).send({ error: "tts not configured" });
      const { text, voice } = req.query;

      const key = createHash("sha256").update(`${voice}\n${text}`).digest("hex");
      const file = join(cacheDir, `${key}.wav`);
      if (existsSync(file)) {
        return reply
          .type("audio/wav")
          .header("cache-control", "public, max-age=31536000, immutable")
          .send(readFileSync(file));
      }

      try {
        const upstream = await fetch(`${base}/synthesize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, voice }),
        });
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          app.log.error({ status: upstream.status, detail }, "tts upstream error");
          return reply.code(502).send({ error: "synthesis failed" });
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        try {
          if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
          writeFileSync(file, buf);
        } catch {
          /* caching is best-effort */
        }
        return reply
          .type("audio/wav")
          .header("cache-control", "public, max-age=31536000, immutable")
          .send(buf);
      } catch (err) {
        app.log.error(err, "tts request failed");
        return reply.code(502).send({ error: "synthesis failed" });
      }
    },
  );

  // Download a voice into the shared volume (allowlisted to the catalog).
  // Admin-only: it writes to the server for everyone.
  r.post(
    "/api/tts/download",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["tts"],
        body: z.object({ voice: z.string().min(1) }),
        response: {
          200: z.object({ ok: z.literal(true), installed: z.array(z.string()) }),
          400: z.object({ error: z.string() }),
          401: z.object({ error: z.string() }),
          403: z.object({ error: z.string() }),
          502: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      if (!base) return reply.code(503).send({ error: "tts not configured" });
      const { voice } = req.body;
      if (!TTS_VOICE_IDS.includes(voice)) {
        return reply.code(400).send({ error: "unknown voice" });
      }
      try {
        const upstream = await fetch(`${base}/download`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ voice }),
        });
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          app.log.error({ status: upstream.status, detail }, "tts download error");
          return reply.code(502).send({ error: "download failed" });
        }
        return { ok: true as const, installed: await installedVoices() };
      } catch (err) {
        app.log.error(err, "tts download request failed");
        return reply.code(502).send({ error: "download failed" });
      }
    },
  );
}
