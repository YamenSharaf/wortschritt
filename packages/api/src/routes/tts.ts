import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ttsAdminBody, ttsAdminSettings as ttsAdminDto, ttsEntriesBody, ttsKeyBody, ttsStatus, ttsTestBody } from "@mdb/shared";
import { wakeStoryAudio } from "../services/storyAudio";
import { addKey, deleteKey, saveEntries, TtsKeyError, updateKey } from "../tts/geminiKeys";
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
      if (req.body.background?.enabled) wakeStoryAudio();
      return ttsAdminSettings();
    },
  );
  // Gemini keys (several projects, free and paid) and the order they're tried in.
  const keyParams = z.object({ id: z.coerce.number().int() });
  /** Run a change to the keys or the order: 404 when it names nothing, 400 for a bad change. */
  const change = (fn: () => boolean | void): { error: string; code: 400 | 404 } | null => {
    try {
      return fn() === false ? { error: "not found", code: 404 } : null;
    } catch (err) {
      if (err instanceof TtsKeyError) return { error: err.message, code: 400 };
      throw err;
    }
  };
  r.post(
    "/api/admin/tts/gemini/keys",
    { preHandler: requireAdmin, schema: { tags: ["admin"], body: ttsKeyBody, response: { 200: ttsAdminDto, 400: failure } } },
    async (req, reply) => {
      const failed = change(() => addKey(req.body));
      return failed ? reply.code(400).send({ error: failed.error }) : ttsAdminSettings();
    },
  );
  r.put(
    "/api/admin/tts/gemini/keys/:id",
    { preHandler: requireAdmin, schema: { tags: ["admin"], params: keyParams, body: ttsKeyBody, response: { 200: ttsAdminDto, 400: failure, 404: failure } } },
    async (req, reply) => {
      const failed = change(() => updateKey(req.params.id, req.body));
      return failed ? reply.code(failed.code).send({ error: failed.error }) : ttsAdminSettings();
    },
  );
  r.delete(
    "/api/admin/tts/gemini/keys/:id",
    { preHandler: requireAdmin, schema: { tags: ["admin"], params: keyParams, response: { 200: ttsAdminDto, 404: failure } } },
    async (req, reply) => (deleteKey(req.params.id) ? ttsAdminSettings() : reply.code(404).send({ error: "not found" })),
  );
  r.put(
    "/api/admin/tts/gemini/entries",
    { preHandler: requireAdmin, schema: { tags: ["admin"], body: ttsEntriesBody, response: { 200: ttsAdminDto, 400: failure } } },
    async (req, reply) => {
      const failed = change(() => saveEntries(req.body.entries));
      return failed ? reply.code(400).send({ error: failed.error }) : ttsAdminSettings();
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
