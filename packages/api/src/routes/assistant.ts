import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/session";
import { env, isAssistantEnabled } from "../env";
import { getSettings } from "../services/settings";

const askBody = z.object({
  selection: z.string().min(1).max(4000),
  question: z.string().max(1000).optional(),
  context: z.string().max(4000).optional(),
});

export async function assistantRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // The web app calls this to decide whether to show the tutor at all.
  r.get(
    "/api/assistant/status",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["assistant"],
        response: {
          200: z.object({ enabled: z.boolean(), model: z.string() }),
        },
      },
    },
    async () => ({ enabled: isAssistantEnabled, model: env.ASSISTANT_MODEL }),
  );

  // Server-side proxy: the API key never reaches the browser. Streams tokens
  // back to the client as Server-Sent Events.
  r.post(
    "/api/assistant/ask",
    { preHandler: requireAuth, schema: { tags: ["assistant"], body: askBody } },
    async (req, reply) => {
      if (!isAssistantEnabled) {
        return reply.code(503).send({ error: "assistant not configured" });
      }

      const { selection, question, context } = req.body;
      const level = getSettings().level;

      const system = [
        `You are a concise, friendly German tutor for a learner at CEFR level ${level}.`,
        "The learner highlighted some text in a German-learning app and wants help.",
        "Explain briefly in English what is most relevant: meaning, grammar (case,",
        "gender, verb form, word order), or a natural translation. Prefer short",
        "answers with a small example when it helps. Do not be verbose.",
      ].join(" ");

      const userParts = [`Highlighted text:\n"""${selection}"""`];
      if (context) userParts.push(`Surrounding context:\n"""${context}"""`);
      userParts.push(question ? `Question: ${question}` : "Explain this.");
      const user = userParts.join("\n\n");

      // Take over the raw socket for SSE; Fastify won't send its own response.
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const send = (obj: unknown) => raw.write(`data: ${JSON.stringify(obj)}\n\n`);

      // Stop talking to the upstream if the browser goes away.
      const controller = new AbortController();
      req.raw.on("close", () => controller.abort());

      try {
        const upstream = await fetch(
          `${env.ASSISTANT_BASE_URL.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(env.ASSISTANT_API_KEY
                ? { authorization: `Bearer ${env.ASSISTANT_API_KEY}` }
                : {}),
            },
            body: JSON.stringify({
              model: env.ASSISTANT_MODEL,
              stream: true,
              temperature: 0.3,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            }),
            signal: controller.signal,
          },
        );

        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => "");
          app.log.error(
            { status: upstream.status, detail },
            "assistant upstream error",
          );
          send({ error: `upstream error (${upstream.status})` });
          raw.write("data: [DONE]\n\n");
          raw.end();
          return;
        }

        // Re-parse the upstream SSE and forward only the text deltas.
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const data = s.slice(5).trim();
            if (data === "[DONE]") continue;
            let json: unknown;
            try {
              json = JSON.parse(data);
            } catch {
              continue;
            }
            const token = (json as ChatChunk)?.choices?.[0]?.delta?.content;
            if (token) send({ token });
          }
        }
        raw.write("data: [DONE]\n\n");
        raw.end();
      } catch (err) {
        if (!controller.signal.aborted) {
          app.log.error(err, "assistant stream failed");
          try {
            send({ error: "assistant request failed" });
            raw.write("data: [DONE]\n\n");
          } catch {
            /* socket already gone */
          }
        }
        try {
          raw.end();
        } catch {
          /* already closed */
        }
      }
    },
  );
}

type ChatChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
};
