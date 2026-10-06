import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { createNoteBody, note, saveNoteBody } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import {
  createNote,
  getNote,
  listNotes,
  removeNote,
  updateNote,
} from "../services/notes";

const ok = z.object({ ok: z.literal(true) });

export async function notesRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/notes",
    {
      preHandler: requireAuth,
      schema: { tags: ["notes"], response: { 200: z.array(note) } },
    },
    async (req) => listNotes(req.user!.id),
  );

  r.get(
    "/api/notes/:id",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["notes"],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: note.nullable() },
      },
    },
    async (req) => getNote(req.user!.id, req.params.id),
  );

  r.post(
    "/api/notes",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["notes"],
        body: createNoteBody,
        response: { 200: note },
      },
    },
    async (req) => createNote(req.user!.id, req.body),
  );

  r.put(
    "/api/notes/:id",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["notes"],
        params: z.object({ id: z.string().min(1) }),
        body: saveNoteBody,
        response: {
          200: note,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const updated = updateNote(req.user!.id, req.params.id, req.body);
      if (!updated) return reply.code(404).send({ error: "note not found" });
      return updated;
    },
  );

  r.delete(
    "/api/notes/:id",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["notes"],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: ok },
      },
    },
    async (req) => {
      removeNote(req.user!.id, req.params.id);
      return { ok: true as const };
    },
  );
}
