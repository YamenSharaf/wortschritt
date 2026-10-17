import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ATTACHMENT_MAX_BYTES, noteAttachment } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { AttachmentError, addAttachment, attachmentFile, isText, removeAttachment } from "../services/attachments";

const failure = z.object({ error: z.string() });
const params = z.object({ id: z.string().min(1) });

/**
 * Files kept with a note. An upload is the file itself as the request body
 * (its media type as the content type, its name in the query), so no
 * multipart parsing is needed.
 */
export async function attachmentRoutes(app: FastifyInstance) {
  // Any body is taken as raw bytes here (this plugin only), up to the file limit.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: ATTACHMENT_MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/notes/:id/attachments",
    {
      preHandler: requireAuth,
      bodyLimit: ATTACHMENT_MAX_BYTES,
      schema: {
        tags: ["notes"],
        params,
        querystring: z.object({ name: z.string().min(1).max(400) }),
        response: { 200: noteAttachment, 400: failure, 404: failure },
      },
    },
    async (req, reply) => {
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      try {
        return addAttachment(req.user!.id, req.params.id, {
          name: req.query.name,
          type: req.headers["content-type"],
          data,
        });
      } catch (err) {
        if (err instanceof AttachmentError) {
          return reply.code(err.message === "note not found" ? 404 : 400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  r.get(
    "/api/attachments/:id",
    {
      preHandler: requireAuth,
      schema: { tags: ["notes"], params, querystring: z.object({ download: z.string().optional() }) },
    },
    async (req, reply) => {
      const file = attachmentFile(req.user!.id, req.params.id);
      if (!file) return reply.code(404).send({ error: "not found" });
      const { type, name } = file.attachment;
      const disposition = req.query.download ? "attachment" : "inline";
      reply
        .type(isText(type) ? `${type}; charset=utf-8` : type)
        .header("content-disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`)
        // Whatever the file is, it can't run anything on the app's origin.
        .header("content-security-policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox")
        .header("x-content-type-options", "nosniff")
        .header("accept-ranges", "bytes")
        // An attachment never changes (a new upload gets a new id).
        .header("cache-control", "private, max-age=31536000, immutable");
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

  r.delete(
    "/api/attachments/:id",
    { preHandler: requireAuth, schema: { tags: ["notes"], params, response: { 200: z.object({ ok: z.literal(true) }), 404: failure } } },
    async (req, reply) => {
      if (!removeAttachment(req.user!.id, req.params.id)) return reply.code(404).send({ error: "not found" });
      return { ok: true as const };
    },
  );
}
