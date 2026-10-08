import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  generateStoryBody,
  saveStoryBody,
  saveStoryTranslationsBody,
  storyTranslations,
  translateStoryBody,
  story,
  storyContext,
  storyProgressBody,
  storySummary,
  storyView,
} from "@mdb/shared";
import { aiErrorMessage } from "../assistant/client";
import { getAiChain } from "../assistant/config";
import { requireAuth } from "../auth/session";
import {
  deleteStory,
  getStory,
  listStories,
  saveStory,
  setStoryProgress,
  updateStory,
} from "../services/stories";
import { buildStoryContext, generateStory, StoryGenerationError } from "../services/storyGen";
import {
  getStoryTranslations,
  saveStoryTranslations,
  TranslationError,
  translateStoryParagraphs,
} from "../services/storyTranslations";
import { clientIp } from "../auth/loginGuard";

const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const ok = z.object({ ok: z.literal(true) });
const failure = z.object({ error: z.string() });
const params = z.object({ id: z.string().min(1) });

/** The signed-in learner's stories (private). */
export async function storyRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/stories",
    { preHandler: requireAuth, schema: { tags: ["stories"], response: { 200: z.array(storySummary) } } },
    async (req) => listStories(req.user!.id),
  );

  r.get(
    "/api/stories/:id",
    {
      preHandler: requireAuth,
      schema: { tags: ["stories"], params, response: { 200: storyView, 404: failure } },
    },
    async (req, reply) => getStory(req.user!.id, req.params.id) ?? reply.code(404).send({ error: "no such story" }),
  );

  r.post(
    "/api/stories",
    {
      preHandler: requireAuth,
      schema: { tags: ["stories"], body: saveStoryBody, response: { 200: storyView, 409: failure } },
    },
    async (req, reply) => {
      const res = saveStory(req.user!.id, req.body.story, { overwrite: req.body.overwrite });
      return res.ok ? res.view : reply.code(409).send({ error: res.error });
    },
  );

  r.put(
    "/api/stories/:id",
    {
      preHandler: requireAuth,
      schema: { tags: ["stories"], params, body: story, response: { 200: storyView, 400: failure, 404: failure } },
    },
    async (req, reply) => {
      if (req.body.id !== req.params.id) {
        return reply.code(400).send({ error: "the story's id can't be changed" });
      }
      return updateStory(req.user!.id, req.params.id, req.body) ?? reply.code(404).send({ error: "no such story" });
    },
  );

  r.delete(
    "/api/stories/:id",
    { preHandler: requireAuth, schema: { tags: ["stories"], params, response: { 200: ok, 404: failure } } },
    async (req, reply) =>
      deleteStory(req.user!.id, req.params.id) ? { ok: true as const } : reply.code(404).send({ error: "no such story" }),
  );

  r.put(
    "/api/stories/:id/progress",
    {
      preHandler: requireAuth,
      schema: { tags: ["stories"], params, body: storyProgressBody, response: { 200: ok, 404: failure } },
    },
    async (req, reply) =>
      setStoryProgress(req.user!.id, req.params.id, req.body.progress, req.body.read)
        ? { ok: true as const }
        : reply.code(404).send({ error: "no such story" }),
  );

  // What story generation would send about the learner (the preview).
  r.get(
    "/api/story-context",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["stories"],
        querystring: z.object({ mistakes: flag, vocab: flag, topics: flag }),
        response: { 200: storyContext },
      },
    },
    async (req) => buildStoryContext(req.user!.id, req.query),
  );

  /**
   * Write a story with the learner's AI and save it. Streams Server-Sent
   * Events — {phase:"writing",chars} / {phase:"checking"} / {phase:"fixing"},
   * then {done:{id,questionsDropped}} or {error} — so a slow model doesn't hit
   * a proxy's idle timeout.
   */
  r.post(
    "/api/stories/generate",
    {
      preHandler: requireAuth,
      schema: { tags: ["stories"], body: generateStoryBody },
    },
    async (req, reply) => {
      const ai = getAiChain(req.user!.id);
      if (!ai) return reply.code(503).send({ error: "Set up your AI tutor under Settings → AI tutor first." });

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const send = (obj: unknown) => {
        try {
          raw.write(`data: ${JSON.stringify(obj)}\n\n`);
        } catch {
          /* socket gone */
        }
      };
      const controller = new AbortController();
      req.raw.on("close", () => controller.abort());
      try {
        const { view, questionsDropped } = await generateStory(req.user!.id, ai, req.body, {
          signal: controller.signal,
          onProgress: send,
          onFallback: (failed, error) =>
            req.log.warn({ provider: failed.provider, model: failed.model, error: error.publicMessage }, "AI model failed, trying the next one"),
        });
        req.log.info({ id: view.story.id, by: req.user!.username }, "story generated");
        send({ done: { id: view.story.id, questionsDropped } });
      } catch (err) {
        if (!controller.signal.aborted) {
          send({
            error: err instanceof StoryGenerationError ? err.message : aiErrorMessage(err, req.log, "story generation"),
          });
        }
      }
      try {
        raw.write("data: [DONE]\n\n");
        raw.end();
      } catch {
        /* already closed */
      }
    },
  );

  // --- line-by-line translations -------------------------------------------
  r.get(
    "/api/stories/:id/translations",
    {
      preHandler: requireAuth,
      schema: { tags: ["stories"], params, response: { 200: storyTranslations, 404: failure } },
    },
    async (req, reply) =>
      getStoryTranslations(req.user!.id, req.params.id) ?? reply.code(404).send({ error: "no such story" }),
  );

  // Translate some paragraphs (those on screen) with the learner's AI.
  r.post(
    "/api/stories/:id/translations",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 40, timeWindow: "1 minute", keyGenerator: clientIp } },
      schema: {
        tags: ["stories"],
        params,
        body: translateStoryBody,
        response: { 200: storyTranslations, 404: failure, 502: failure, 503: failure },
      },
    },
    async (req, reply) => {
      const ai = getAiChain(req.user!.id);
      if (!ai) return reply.code(503).send({ error: "Set up your AI tutor under Settings → AI tutor first." });
      try {
        const view = await translateStoryParagraphs(req.user!.id, req.params.id, ai, req.body.paragraphs, {
          onFallback: (failed, error) =>
            req.log.warn({ provider: failed.provider, model: failed.model, error: error.publicMessage }, "AI model failed, trying the next one"),
        });
        return view ?? reply.code(404).send({ error: "no such story" });
      } catch (err) {
        const error = err instanceof TranslationError ? err.message : aiErrorMessage(err, req.log, "story translation");
        return reply.code(502).send({ error });
      }
    },
  );

  // Provide the lines yourself (e.g. an agent that wrote the story).
  r.put(
    "/api/stories/:id/translations",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["stories"],
        params,
        body: saveStoryTranslationsBody,
        response: { 200: storyTranslations, 400: failure, 404: failure },
      },
    },
    async (req, reply) => {
      const res = saveStoryTranslations(req.user!.id, req.params.id, req.body.paragraphs);
      return res.ok ? res.view : reply.code(res.status).send({ error: res.error });
    },
  );
}
