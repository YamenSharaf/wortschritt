import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { setCoverBody } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { coverFor, coverVersion, setCover, type CoverKind } from "../services/covers";

const failure = z.object({ error: z.string() });
const params = z.object({ id: z.string().min(1) });

/**
 * Cover art for the learner's stories and series. The SVG is served as an
 * image with a locked-down CSP (it's model-written, though already checked);
 * items without art get a generated cover.
 */
export async function coverRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  for (const [kind, base] of [
    ["story", "/api/stories"],
    ["series", "/api/series"],
  ] as Array<[CoverKind, string]>) {
    r.get(
      `${base}/:id/cover.svg`,
      { preHandler: requireAuth, schema: { tags: ["covers"], params } },
      async (req, reply) => {
        const cover = coverFor(req.user!.id, kind, req.params.id);
        if (!cover) return reply.code(404).send({ error: `no such ${kind}` });
        reply
          .header("content-type", "image/svg+xml; charset=utf-8")
          .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
          .header("x-content-type-options", "nosniff")
          // The URL carries the cover's version, so it can be cached for long.
          .header("cache-control", "private, max-age=31536000, immutable")
          .send(cover.svg);
      },
    );

    r.put(
      `${base}/:id/cover`,
      {
        preHandler: requireAuth,
        schema: {
          tags: ["covers"],
          params,
          body: setCoverBody,
          response: { 200: z.object({ cover: z.string().nullable() }), 404: failure },
        },
      },
      async (req, reply) =>
        setCover(req.user!.id, kind, req.params.id, req.body.svg)
          ? { cover: coverVersion(req.body.svg) }
          : reply.code(404).send({ error: `no such ${kind}` }),
    );
  }
}
