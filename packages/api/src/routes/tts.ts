import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ttsAdminBody, ttsAdminSettings as ttsAdminDto, ttsStatus, ttsTestBody } from "@mdb/shared";
import { requireAdmin, requireAuth } from "../auth/session";
import { clip } from "../tts/cache";
import {
  synthesize,
  TtsConfigError,
  ttsAdminSettings,
  TtsUnavailable,
  updateTtsSettings,
  offeredVoices,
} from "../tts/providers";

export async function ttsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const failure = z.object({ error: z.string() });

  r.get(
    "/api/tts/status",
    {
      preHandler: requireAuth,
      schema: { tags: ["tts"], response: { 200: ttsStatus } },
    },
    async () => {
      const voices = await offeredVoices();
      return {
        available: voices.length > 0,
        installed: voices.map((v) => v.id),
        voices,
      };
    },
  );

  // Synthesize (or serve a cached clip). GET so an <audio> element can play it
  // directly; the session cookie (or the app's bearer token) authenticates it.
  r.get(
    "/api/tts",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["tts"],
        querystring: z.object({
          text: z.string().min(1).max(500),
          voice: z.string().min(1).max(100),
        }),
      },
    },
    async (req, reply) => {
      const { text, voice } = req.query;
      try {
        const { audio, type } = await clip(text, voice);
        return reply.type(type).header("cache-control", "public, max-age=31536000, immutable").send(audio);
      } catch (err) {
        if (err instanceof TtsUnavailable) {
          app.log.warn({ voice, reason: err.message }, "tts voice unavailable");
          return reply.code(503).send({ error: err.message });
        }
        app.log.error(err, "tts synthesis failed");
        return reply.code(502).send({ error: err instanceof Error ? err.message : "synthesis failed" });
      }
    },
  );

  // Read-aloud providers (admin): Azure key + region, Edge on/off.
  r.get(
    "/api/admin/tts",
    { preHandler: requireAdmin, schema: { tags: ["admin"], response: { 200: ttsAdminDto } } },
    async () => ttsAdminSettings(),
  );
  r.put(
    "/api/admin/tts",
    { preHandler: requireAdmin, schema: { tags: ["admin"], body: ttsAdminBody, response: { 200: ttsAdminDto, 400: failure } } },
    async (req, reply) => {
      try {
        updateTtsSettings(req.body);
      } catch (err) {
        if (err instanceof TtsConfigError) return reply.code(400).send({ error: err.message });
        throw err;
      }
      return ttsAdminSettings();
    },
  );
  // Try a voice end to end (uncached), reporting the provider's error.
  r.post(
    "/api/admin/tts/test",
    {
      preHandler: requireAdmin,
      schema: { tags: ["admin"], body: ttsTestBody, response: { 200: z.object({ ok: z.literal(true), bytes: z.number() }), 400: failure } },
    },
    async (req, reply) => {
      try {
        const { audio } = await synthesize("Guten Tag! Ich lerne Deutsch.", req.body.voice);
        return { ok: true as const, bytes: audio.length };
      } catch (err) {
        app.log.warn({ err, voice: req.body.voice }, "tts test failed");
        return reply.code(400).send({ error: err instanceof Error ? err.message : "failed" });
      }
    },
  );

}
