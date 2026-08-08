import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { exerciseItem, exerciseSet, type ExerciseItem } from "@mdb/shared";
import { requireAuth } from "../auth/session";
import {
  buildMessages,
  buildChatSystem,
  buildGenerateMessages,
} from "../assistant/prompts";
import { env, isAssistantEnabled } from "../env";
import { getSettings } from "../services/settings";

const askBody = z.object({
  task: z
    .enum([
      "highlight",
      "hint",
      "why_wrong",
      "translate_exercise",
      "translate_sheet",
      "chat",
    ])
    .default("highlight"),
  // highlight-to-explain
  selection: z.string().max(4000).optional(),
  question: z.string().max(1000).optional(),
  context: z.string().max(4000).optional(),
  // per-exercise help (hint / why_wrong / translate_exercise / chat)
  item: z
    .object({
      type: z.string(),
      label: z.string().max(4000),
      expected: z.array(z.string()).default([]),
    })
    .optional(),
  response: z.string().max(2000).optional(),
  // translate_sheet
  text: z.string().max(8000).optional(),
  // chat: prior turns of the conversation
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(6000),
      }),
    )
    .max(24)
    .optional(),
});

const gradeBody = z.object({
  prompt: z.string().max(2000).optional(),
  expected: z.array(z.string().min(1)).min(1),
  response: z.string().min(1).max(2000),
});

const generateBody = z.object({
  count: z.number().int().min(1).max(6).default(3),
  set: z.object({
    title: z.string().default(""),
    level: z.string().default("A2"),
    tags: z.array(z.string()).default([]),
    types: z.array(z.string()).min(1),
    samples: z.array(z.unknown()).max(4).default([]),
  }),
});

/**
 * Validate one generated item against BOTH the item schema and the structural
 * checks (cloze placeholders, table answer counts) by round-tripping it through
 * a one-item exerciseSet. Returns the clean item or null.
 */
function validGeneratedItem(raw: unknown, id: string): ExerciseItem | null {
  const parsed = exerciseItem.safeParse(raw);
  if (!parsed.success) return null;
  const item = { ...parsed.data, id };
  const set = exerciseSet.safeParse({
    id: "gen",
    title: "gen",
    level: "A1",
    items: [item],
  });
  return set.success ? item : null;
}

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

  // Generate a few fresh items in the style of a completed set. Ephemeral:
  // validated and returned, never persisted. Malformed items are dropped.
  r.post(
    "/api/assistant/generate",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["assistant"],
        body: generateBody,
        response: {
          200: z.object({ items: z.array(exerciseItem) }),
          502: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      if (!isAssistantEnabled) {
        return reply.code(503).send({ error: "assistant not configured" });
      }
      const { count, set } = req.body;
      const { system, user } = buildGenerateMessages({
        title: set.title,
        level: set.level,
        tags: set.tags,
        types: set.types,
        count,
        samples: JSON.stringify(set.samples).slice(0, 3000),
      });

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
              temperature: 0.8,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            }),
          },
        );
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          app.log.error({ status: upstream.status, detail }, "generate upstream error");
          return reply.code(502).send({ error: "generation failed" });
        }
        const json = (await upstream.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json?.choices?.[0]?.message?.content ?? "";
        const match = content.match(/\{[\s\S]*\}/);
        let rawItems: unknown[] = [];
        if (match) {
          try {
            const parsed = JSON.parse(match[0]) as { items?: unknown };
            if (Array.isArray(parsed.items)) rawItems = parsed.items;
          } catch {
            /* leave empty → 0 valid items */
          }
        }
        const stamp = Date.now().toString(36);
        const items = rawItems
          .map((raw, i) => validGeneratedItem(raw, `gen-${stamp}-${i}`))
          .filter((x): x is ExerciseItem => x !== null)
          .slice(0, count);
        return { items };
      } catch (err) {
        app.log.error(err, "generate request failed");
        return reply.code(502).send({ error: "generation failed" });
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

      const { task, selection, question, context, item, response, text, history } =
        req.body;
      const level = getSettings().level;

      // Build the chat-completions message list. "chat" is multi-turn; the rest
      // are a single system+user pair from the prompt registry.
      let messages: Array<{ role: string; content: string }>;
      if (task === "chat") {
        if (!item || !history || history.length === 0) {
          return reply.code(400).send({ error: "missing inputs for task" });
        }
        messages = [
          { role: "system", content: buildChatSystem({ level, item, response }) },
          ...history,
        ];
      } else {
        const built = buildMessages(task, {
          level,
          selection,
          question,
          context,
          item,
          response,
          text,
        });
        if (!built) {
          return reply.code(400).send({ error: "missing inputs for task" });
        }
        messages = [
          { role: "system", content: built.system },
          { role: "user", content: built.user },
        ];
      }

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
              messages,
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
