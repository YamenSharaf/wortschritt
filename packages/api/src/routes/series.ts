import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { saveChapterBody, saveSeriesBody, seriesSummary, seriesView, storyView } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { seriesEpub } from "../services/epub";
import { deleteSeries, getSeriesView, listSeries, saveChapter, saveSeries } from "../services/series";

const ok = z.object({ ok: z.literal(true) });
const failure = z.object({ error: z.string() });
const params = z.object({ id: z.string().min(1) });

/** The signed-in learner's series (books whose chapters are stories). */
export async function seriesRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/series",
    { preHandler: requireAuth, schema: { tags: ["series"], response: { 200: z.array(seriesSummary) } } },
    async (req) => listSeries(req.user!.id),
  );

  r.get(
    "/api/series/:id",
    { preHandler: requireAuth, schema: { tags: ["series"], params, response: { 200: seriesView, 404: failure } } },
    async (req, reply) => getSeriesView(req.user!.id, req.params.id) ?? reply.code(404).send({ error: "no such series" }),
  );

  // Create (or with overwrite, replace the bible/outline/metadata; chapters stay).
  r.post(
    "/api/series",
    {
      preHandler: requireAuth,
      schema: { tags: ["series"], body: saveSeriesBody, response: { 200: seriesView, 409: failure } },
    },
    async (req, reply) => {
      const res = saveSeries(req.user!.id, req.body.series, { overwrite: req.body.overwrite });
      return res.ok ? res.view : reply.code(409).send({ error: res.error });
    },
  );

  // Delete a series and all its chapters.
  r.delete(
    "/api/series/:id",
    { preHandler: requireAuth, schema: { tags: ["series"], params, response: { 200: ok, 404: failure } } },
    async (req, reply) =>
      deleteSeries(req.user!.id, req.params.id) ? { ok: true as const } : reply.code(404).send({ error: "no such series" }),
  );

  // Write chapter n (its story id is derived from the series id).
  r.put(
    "/api/series/:id/chapters/:n",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["series"],
        params: z.object({ id: z.string().min(1), n: z.coerce.number().int().min(1).max(200) }),
        body: saveChapterBody,
        response: { 200: storyView, 404: failure, 409: failure },
      },
    },
    async (req, reply) => {
      const res = saveChapter(req.user!.id, req.params.id, req.params.n, req.body.story, req.body.summary, {
        overwrite: req.body.overwrite,
      });
      return res.ok ? res.view : reply.code(res.status).send({ error: res.error });
    },
  );

  // Download the written chapters as one EPUB.
  r.get(
    "/api/series/:id/epub",
    { preHandler: requireAuth, schema: { tags: ["series"], params } },
    async (req, reply) => {
      const file = seriesEpub(req.user!.id, req.params.id);
      if (!file) return reply.code(404).send({ error: "no such series" });
      if (file === "empty") return reply.code(409).send({ error: "no chapters written yet" });
      reply
        .header("content-type", "application/epub+zip")
        .header("content-disposition", `attachment; filename="${file.filename}"`)
        .header("cache-control", "no-store")
        .send(Buffer.from(file.data));
    },
  );
}
