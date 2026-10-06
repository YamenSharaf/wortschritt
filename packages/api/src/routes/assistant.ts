import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  aiSettingsView,
  exerciseItem,
  exerciseSet,
  MAX_GENERATE_COUNT,
  saveAiSettingsBody,
  wordLookup,
  wordQueryBody,
  type ExerciseItem,
} from "@mdb/shared";
import { clientIp } from "../auth/loginGuard";
import { requireAuth } from "../auth/session";
import {
  buildMessages,
  buildChatSystem,
  buildGenerateMessages,
  buildNotesCleanup,
  buildWordMessages,
} from "../assistant/prompts";
import { aiErrorMessage, collectCompletion, streamCompletion } from "../assistant/client";
import {
  deleteAiSettings,
  getAiConfig,
  getAiSettingsView,
  saveAiSettings,
} from "../assistant/config";
import { EgressError } from "../assistant/egress";
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
  /** The sentence beginning already shown to the learner (if any). Lets the
   *  grader accept a completion-only answer that fits the given stem. */
  context: z.string().max(2000).optional(),
  /** Open-ended task: `expected` are examples, not the full list. */
  open: z.boolean().optional(),
});

const cleanupNotesBody = z.object({
  text: z.string().min(1).max(12000),
});

const generateBody = z.object({
  count: z.number().int().min(1).max(MAX_GENERATE_COUNT).default(5),
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
  // The server owns item ids, so inject ours before validating. Otherwise a
  // model that omits "id" (or supplies a non-string one) fails the schema and
  // the item is silently dropped — the whole batch can vanish this way.
  const withId =
    raw && typeof raw === "object" ? { ...(raw as object), id } : raw;
  const parsed = exerciseItem.safeParse(withId);
  if (!parsed.success) return null;
  const item = parsed.data;
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

/** Best-effort extraction of one JSON object from a model reply that may be
 *  wrapped in ```json fences or padded with stray prose. */
function extractJsonObject(content: string): unknown | null {
  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  const candidates = [s];
  const braced = s.match(/\{[\s\S]*\}/);
  if (braced) candidates.push(braced[0]);
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

const NOT_SET_UP = "Set up your AI tutor under Settings → AI tutor first.";

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
    async (req) => {
      const ai = getAiConfig(req.user!.id);
      return { enabled: ai !== null, model: ai?.model ?? "" };
    },
  );

  // The signed-in user's AI tutor settings (never returns the key).
  r.get(
    "/api/assistant/settings",
    {
      preHandler: requireAuth,
      schema: { tags: ["assistant"], response: { 200: aiSettingsView } },
    },
    async (req) => getAiSettingsView(req.user!.id),
  );

  r.put(
    "/api/assistant/settings",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["assistant"],
        body: saveAiSettingsBody,
        response: { 200: aiSettingsView, 400: z.object({ error: z.string() }) },
      },
    },
    async (req, reply) => {
      if (req.body.apiKey && !getAiSettingsView(req.user!.id).encryptionAvailable) {
        return reply.code(400).send({
          error: "This server can't store API keys yet (the admin needs to set ENCRYPTION_KEY).",
        });
      }
      try {
        return saveAiSettings(req.user!.id, req.body);
      } catch (err) {
        if (err instanceof EgressError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  r.delete(
    "/api/assistant/settings",
    {
      preHandler: requireAuth,
      schema: { tags: ["assistant"], response: { 200: aiSettingsView } },
    },
    async (req) => {
      deleteAiSettings(req.user!.id);
      return getAiSettingsView(req.user!.id);
    },
  );

  // "Test connection": one tiny completion against the saved settings.
  r.post(
    "/api/assistant/test",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: clientIp } },
      schema: {
        tags: ["assistant"],
        response: {
          200: z.object({ ok: z.literal(true), reply: z.string() }),
          502: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const ai = getAiConfig(req.user!.id);
      if (!ai) return reply.code(503).send({ error: NOT_SET_UP });
      try {
        const text = await collectCompletion(
          ai,
          [{ role: "user", content: "Reply with just the word: OK" }],
          { temperature: 0, maxTokens: 5 },
        );
        return { ok: true as const, reply: text.trim().slice(0, 100) };
      } catch (err) {
        return reply.code(502).send({ error: aiErrorMessage(err, req.log, "test") });
      }
    },
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
      const ai = getAiConfig(req.user!.id);
      if (!ai) return reply.code(503).send({ error: NOT_SET_UP });
      const { prompt, expected, response, context, open } = req.body;
      const system =
        "You grade short German-learning answers. Decide if the learner's answer is acceptable German for the task, allowing valid variants (word order, punctuation, equivalent spellings) but requiring correct grammar and meaning. " +
        "The learner is often completing a sentence whose beginning is already shown to them (given as 'Shown to the learner'). When it is, accept an answer that supplies only the missing part if, combined with that beginning, it forms a correct sentence — do NOT require the learner to retype the part they were already given. Only mark such an answer wrong if the completion itself is grammatically wrong or doesn't fit. " +
        "When the reference answers are marked as examples, the task is open-ended: judge whether the learner's answer correctly and sensibly fulfils the task on its own merits — it does not need to resemble the examples. " +
        "Reply with ONLY a compact JSON object: {\"correct\": boolean, \"feedback\": \"one short sentence in English\"}.";
      const user = [
        prompt ? `Task: ${prompt}` : null,
        context ? `Shown to the learner (sentence beginning): ${context}` : null,
        open
          ? `Example answers (open-ended — any other correct answer also counts): ${expected.join(" | ")}`
          : `Reference answer(s) (full sentence): ${expected.join(" | ")}`,
        `Learner answer: ${response}`,
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const content = await collectCompletion(
          ai,
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { temperature: 0, maxTokens: 256 },
        );
        return parseVerdict(content);
      } catch (err) {
        return reply.code(502).send({ error: aiErrorMessage(err, req.log, "grade") });
      }
    },
  );

  // Translate a single word → { translation, examples: [{de,en}] }. Powers the
  // tap-a-word menu and the Vocab tab. Callers cache the result themselves.
  r.post(
    "/api/assistant/word",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["assistant"],
        body: wordQueryBody.extend({
          count: z.number().int().min(1).max(4).default(2),
        }),
        response: {
          200: wordLookup,
          502: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const ai = getAiConfig(req.user!.id);
      if (!ai) return reply.code(503).send({ error: NOT_SET_UP });
      const { word, context, meaning, count } = req.body;
      const { system, user } = buildWordMessages({ word, context, meaning, count });
      try {
        const content = await collectCompletion(
          ai,
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { temperature: 0.4, maxTokens: 900 },
        );
        const obj = extractJsonObject(content);
        const parsed = obj ? wordLookup.safeParse(obj) : null;
        if (!parsed || !parsed.success) {
          app.log.warn(
            { content: content.slice(0, 300) },
            "word: could not parse tutor reply",
          );
          return reply
            .code(502)
            .send({ error: "could not read the tutor's reply — try again" });
        }
        return parsed.data;
      } catch (err) {
        return reply.code(502).send({ error: aiErrorMessage(err, req.log, "word") });
      }
    },
  );

  // Tidy rough learning notes into clean Markdown. Returns the whole cleaned
  // note as one string (the client swaps it into the editor).
  r.post(
    "/api/assistant/cleanup-notes",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["assistant"],
        body: cleanupNotesBody,
        response: {
          200: z.object({ text: z.string() }),
          502: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const ai = getAiConfig(req.user!.id);
      if (!ai) return reply.code(503).send({ error: NOT_SET_UP });
      const { system, user } = buildNotesCleanup({
        level: getSettings(req.user!.id).level,
        text: req.body.text,
      });
      try {
        const content = await collectCompletion(
          ai,
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { temperature: 0.2, maxTokens: 4096 },
        );
        // Strip an accidental ```markdown fence if the model added one anyway.
        let text = content.trim();
        const fence = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
        if (fence?.[1]) text = fence[1].trim();
        if (!text) {
          return reply.code(502).send({ error: "empty reply — try again" });
        }
        return { text };
      } catch (err) {
        return reply.code(502).send({ error: aiErrorMessage(err, req.log, "cleanup-notes") });
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
          200: z.object({
            items: z.array(exerciseItem),
            // How many raw items the model returned, so the client can tell
            // "model returned nothing" from "returned items that were invalid".
            received: z.number().int(),
          }),
          502: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const ai = getAiConfig(req.user!.id);
      if (!ai) return reply.code(503).send({ error: NOT_SET_UP });
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
        // Scale the token budget with how many items were asked for (each item
        // is a few hundred tokens of JSON). Streamed (see collectCompletion) so
        // it uses the same upstream path as the tutor, which is known to work.
        const content = await collectCompletion(
          ai,
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { temperature: 0.8, maxTokens: Math.min(8192, 1024 + count * 500) },
        );
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
        if (items.length < rawItems.length) {
          app.log.warn(
            { received: rawItems.length, valid: items.length },
            "generate: some items failed validation and were dropped",
          );
        }
        return { items, received: rawItems.length };
      } catch (err) {
        return reply.code(502).send({ error: aiErrorMessage(err, req.log, "generate") });
      }
    },
  );

  // Server-side proxy: the API key never reaches the browser. Streams tokens
  // back to the client as Server-Sent Events.
  r.post(
    "/api/assistant/ask",
    { preHandler: requireAuth, schema: { tags: ["assistant"], body: askBody } },
    async (req, reply) => {
      const ai = getAiConfig(req.user!.id);
      if (!ai) return reply.code(503).send({ error: NOT_SET_UP });

      const { task, selection, question, context, item, response, text, history } =
        req.body;
      const level = getSettings(req.user!.id).level;

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
        for await (const token of streamCompletion(ai, messages, {
          temperature: 0.3,
          maxTokens: 1024,
          signal: controller.signal,
        })) {
          send({ token });
        }
        raw.write("data: [DONE]\n\n");
        raw.end();
      } catch (err) {
        if (!controller.signal.aborted) {
          try {
            send({ error: aiErrorMessage(err, req.log, "assistant stream") });
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
