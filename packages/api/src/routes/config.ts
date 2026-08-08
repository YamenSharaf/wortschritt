import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../env";

/** Public branding config — read before login, so no auth. */
export async function configRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/api/config",
    {
      schema: {
        tags: ["config"],
        response: {
          200: z.object({ appName: z.string(), appEmoji: z.string() }),
        },
      },
    },
    async () => ({ appName: env.APP_NAME, appEmoji: env.APP_EMOJI }),
  );
}
