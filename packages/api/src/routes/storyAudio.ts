import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { partialStoryAudio as partialDto, storyAudio, storyAudioBrief } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { allStoryAudio, partialStoryAudio, startSeriesAudio, startStoryAudio, StoryAudioError, storyAudioPath, storyAudioStatus } from "../services/storyAudio";

/** A story as one audio file: its status, making it, and the file (with Range, so players can seek). */
export async function storyAudioRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ id: z.string().min(1) });
  const failure = z.object({ error: z.string() });

  const briefs = z.record(z.string(), storyAudioBrief);

  r.get(
    "/api/story-audio",
    { preHandler: requireAuth, schema: { tags: ["stories"], description: "Every story's audio in short, by story id.", response: { 200: briefs } } },
    async (req) => allStoryAudio(req.user!.id),
  );

  r.post(
    "/api/series/:id/audio",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["series"],
        description: "Generate the audiobook: queue every written chapter, in order; returns the chapters' audio by story id.",
        params,
        response: { 200: briefs, 404: failure, 409: failure },
      },
    },
    async (req, reply) => {
      try {
        return startSeriesAudio(req.user!.id, req.params.id, req.log) ?? reply.code(404).send({ error: "not found" });
      } catch (err) {
        if (err instanceof StoryAudioError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  r.get(
    "/api/stories/:id/audio",
    { preHandler: requireAuth, schema: { tags: ["stories"], params, response: { 200: storyAudio, 404: failure } } },
    async (req, reply) => storyAudioStatus(req.user!.id, req.params.id) ?? reply.code(404).send({ error: "not found" }),
  );

  r.post(
    "/api/stories/:id/audio",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["stories"],
        description: "Start making the story's audio in the reading voice (once); poll GET for progress.",
        params,
        response: { 200: storyAudio, 404: failure, 409: failure },
      },
    },
    async (req, reply) => {
      try {
        return startStoryAudio(req.user!.id, req.params.id, req.log) ?? reply.code(404).send({ error: "not found" });
      } catch (err) {
        if (err instanceof StoryAudioError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  r.post(
    "/api/stories/:id/audio/partial",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["stories"],
        description: "While the audio waits: the paragraphs made so far, from the start, as a file to listen to (404 when there are none, or it's ready).",
        params,
        response: { 200: partialDto, 404: failure },
      },
    },
    async (req, reply) => partialStoryAudio(req.user!.id, req.params.id) ?? reply.code(404).send({ error: "nothing to listen to yet" }),
  );

  r.get(
    "/api/stories/:id/audio/:key",
    { preHandler: requireAuth, schema: { tags: ["stories"], params: params.extend({ key: z.string().regex(/^[0-9a-f]{32}(\.mp3)?$/) }) } },
    async (req, reply) => {
      const file = storyAudioPath(req.user!.id, req.params.id, req.params.key.replace(/\.mp3$/, ""));
      if (!file) return reply.code(404).send({ error: "not found" });
      reply.type("audio/mpeg").header("accept-ranges", "bytes").header("cache-control", "private, max-age=31536000, immutable");
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
        if (start > end || start >= file.size) return reply.code(416).header("content-range", `bytes */${file.size}`).send();
        return reply
          .code(206)
          .header("content-range", `bytes ${start}-${end}/${file.size}`)
          .header("content-length", end - start + 1)
          .send(createReadStream(file.path, { start, end }));
      }
      return reply.header("content-length", file.size).send(createReadStream(file.path));
    },
  );
}
