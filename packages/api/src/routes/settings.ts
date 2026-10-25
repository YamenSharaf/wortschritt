import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { settingsSchema } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import { getSettings, saveSettings } from "../services/settings";
import { wakeStoryAudio } from "../services/storyAudio";

export async function settingsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/settings",
    {
      preHandler: requireAuth,
      schema: { tags: ["settings"], response: { 200: settingsSchema } },
    },
    async (req) => getSettings(req.user!.id),
  );

  r.put(
    "/api/settings",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["settings"],
        body: settingsSchema,
        response: { 200: settingsSchema },
      },
    },
    async (req) => {
      const saved = saveSettings(req.user!.id, req.body);
      // Audiobooks made ahead of time: start looking for work now.
      if (saved.audiobooks.auto) wakeStoryAudio();
      return saved;
    },
  );
}
