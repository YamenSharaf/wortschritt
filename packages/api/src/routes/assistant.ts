import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/session";
import { buildMessages } from "../assistant/prompts";
import { env, isAssistantEnabled } from "../env";
import { getSettings } from "../services/settings";

const askBody = z.object({
  task: z.enum(["highlight", "hint", "why_wrong"]).default("highlight"),
  // highlight-to-explain
  selection: z.string().max(4000).optional(),
  question: z.string().max(1000).optional(),
  context: z.string().max(4000).optional(),
  // per-exercise help (hint / why_wrong)
  item: z
    .object({
      type: z.string(),
      label: z.string().max(4000),
      expected: z.array(z.string()).default([]),
    })
    .optional(),
  response: z.string().max(2000).optional(),
});

const gradeBody = z.object({
  prompt: z.string().max(2000).optional(),
  expected: z.array(z.string().min(1)).min(1),
  response: z.string().min(1).max(2000),
});

function parseVerdict(content: string): { correct: boolean; feedback: string } {
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const o = JSON.parse(match[0]) as { correct?: unknown; feedback?: unknown };
      if (typeof o.correct === "boolean") {
        return { correct: o.correct, feedback: String(o.feedback ?? "") };
      }
    } catch {
      /* fall through to heuristic */
    }
  }
  const correct =
    /"?correct"?\s*[:=]\s*true/i.test(content) ||
    (/\brichtig\b/i.test(content) && !/falsch|nicht richtig/i.test(content));
  return { correct, feedback: content.slice(0, 200).trim() };
}

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

  // Judge a free-text answer (used as a lenient fallback when local grading
  // misses). Non-streaming: returns a single verdict.
  r.post(
    "/api/assistant/grade",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["assistant"],
        body: gradeBody,
        response: {
          200: z.object({ correct: z.boolean(), feedback: z.string() }),
          502: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      if (!isAssistantEnabled) {
        return reply.code(503).send({ error: "assistant not configured" });
      }
      const { prompt, expected, response } = req.body;
      const system =
        "You grade short German-learning answers. Decide if the learner's answer is acceptable German for the task, allowing valid variants (word order, punctuation, equivalent spellings) but requiring correct grammar and meaning. Reply with ONLY a compact JSON object: {\"correct\": boolean, \"feedback\": \"one short sentence in English\"}.";
      const user = [
        prompt ? `Task: ${prompt}` : null,
        `Reference answer(s): ${expected.join(" | ")}`,
        `Learner answer: ${response}`,
      ]
        .filter(Boolean)
        .join("\n");

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
              temperature: 0,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            }),
          },
        );
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          app.log.error({ status: upstream.status, detail }, "grade upstream error");
          return reply.code(502).send({ error: "grading failed" });
        }
        const json = (await upstream.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json?.choices?.[0]?.message?.content ?? "";
        return parseVerdict(content);
      } catch (err) {
        app.log.error(err, "grade request failed");
        return reply.code(502).send({ error: "grading failed" });
      }
    },
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

      const { task, selection, question, context, item, response } = req.body;
      const messages = buildMessages(task, {
        level: getSettings().level,
        selection,
        question,
        context,
        item,
        response,
      });
      if (!messages) {
        return reply.code(400).send({ error: "missing inputs for task" });
      }
      const { system, user } = messages;

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
