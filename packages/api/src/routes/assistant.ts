import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  aiModelOption,
  aiSettingsView,
  aiTestResult,
  saveAiModelsBody,
  saveAiProviderBody,
  wordLookup,
  germanWord,
  germanWordBody,
  wordQueryBody,
} from "@mdb/shared";
import { clientIp } from "../auth/loginGuard";
import { requireAuth } from "../auth/session";
import {
  buildMessages,
  buildChatSystem,
  buildGenerateMessages,
  buildNotesCleanup,
  buildWordMessages,
  buildGermanWordMessages,
} from "../assistant/prompts";
import {
  aiErrorMessage,
  collectCompletion,
  collectFromOne,
  listModels,
  streamCompletion,
  type OnFallback,
} from "../assistant/client";
import {
  deleteAiProvider,
  deleteAllAiSettings,
  getAiChain,
  getAiSettingsView,
  getProviderConfig,
  saveAiModels,
  saveAiProvider,
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

const cleanupNotesBody = z.object({
  text: z.string().min(1).max(12000),
});

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

const NOT_SET_UP = "Set up your AI tutor under Settings → Connections first.";

/** Log when a model in the user's list fails and the next one is tried. */
const logFallback =
  (log: FastifyBaseLogger): OnFallback =>
  (failed, error) =>
    log.warn(
      { provider: failed.provider, model: failed.model, error: error.publicMessage },
      "AI model failed, trying the next one",
    );

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
      const ai = getAiChain(req.user!.id);
      return { enabled: ai !== null, model: ai?.[0]?.model ?? "" };
    },
  );

  // The signed-in user's AI providers and model order (never returns keys).
  r.get(
    "/api/assistant/settings",
    {
      preHandler: requireAuth,
      schema: { tags: ["assistant"], response: { 200: aiSettingsView } },
    },
    async (req) => getAiSettingsView(req.user!.id),
  );

  // Turn the tutor off: remove every provider and model.
  r.delete(
    "/api/assistant/settings",
    {
      preHandler: requireAuth,
      schema: { tags: ["assistant"], response: { 200: aiSettingsView } },
    },
    async (req) => {
      deleteAllAiSettings(req.user!.id);
      return getAiSettingsView(req.user!.id);
    },
  );

  const providerResponses = {
    200: aiSettingsView,
    400: z.object({ error: z.string() }),
    404: z.object({ error: z.string() }),
  };
  const idParams = z.object({ id: z.coerce.number().int().positive() });

  /** Shared by create and update: key storage needs ENCRYPTION_KEY; URL rules. */
  async function storeProvider(
    req: { user: { id: number } | null; body: z.infer<typeof saveAiProviderBody> },
    reply: FastifyReply,
    id?: number,
  ) {
    const userId = req.user!.id;
    if (req.body.apiKey && !getAiSettingsView(userId).encryptionAvailable) {
      return reply.code(400).send({
        error: "This server can't store API keys yet (the admin needs to set ENCRYPTION_KEY).",
      });
    }
    try {
      if (!saveAiProvider(userId, req.body, id)) {
        return reply.code(404).send({ error: "no such provider" });
      }
    } catch (err) {
      if (err instanceof EgressError) return reply.code(400).send({ error: err.message });
      throw err;
    }
    return getAiSettingsView(userId);
  }

  r.post(
    "/api/assistant/providers",
    {
      preHandler: requireAuth,
      schema: { tags: ["assistant"], body: saveAiProviderBody, response: providerResponses },
    },
    async (req, reply) => storeProvider(req, reply),
  );

  r.put(
    "/api/assistant/providers/:id",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["assistant"],
        params: idParams,
        body: saveAiProviderBody,
        response: providerResponses,
      },
    },
    async (req, reply) => storeProvider(req, reply, req.params.id),
  );

  r.delete(
    "/api/assistant/providers/:id",
    {
      preHandler: requireAuth,
      schema: { tags: ["assistant"], params: idParams, response: { 200: aiSettingsView } },
    },
    async (req) => {
      deleteAiProvider(req.user!.id, req.params.id);
      return getAiSettingsView(req.user!.id);
    },
  );

  // The provider's model list, for the picker.
  r.get(
    "/api/assistant/providers/:id/models",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: clientIp } },
      schema: {
        tags: ["assistant"],
        params: idParams,
        response: {
          200: z.array(aiModelOption),
          404: z.object({ error: z.string() }),
          502: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const p = getProviderConfig(req.user!.id, req.params.id);
      if (!p) return reply.code(404).send({ error: "no such provider" });
      try {
        return await listModels(p);
      } catch (err) {
        return reply.code(502).send({ error: aiErrorMessage(err, req.log, "list models") });
      }
    },
  );

  // Replace the ordered model list (the fallback order).
  r.put(
    "/api/assistant/models",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["assistant"],
        body: saveAiModelsBody,
        response: { 200: aiSettingsView, 400: z.object({ error: z.string() }) },
      },
    },
    async (req, reply) => {
      if (!saveAiModels(req.user!.id, req.body)) {
        return reply.code(400).send({ error: "unknown provider" });
      }
      return getAiSettingsView(req.user!.id);
    },
  );

  // "Test connection": one tiny completion per model entry, each on its own.
  r.post(
    "/api/assistant/test",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: clientIp } },
      schema: {
        tags: ["assistant"],
        response: { 200: aiTestResult, 503: z.object({ error: z.string() }) },
      },
    },
    async (req, reply) => {
      const chain = getAiChain(req.user!.id);
      if (!chain) return reply.code(503).send({ error: NOT_SET_UP });
      const results = await Promise.all(
        chain.map(async (cfg) => {
          const started = Date.now();
          const base = { id: cfg.entryId, provider: cfg.provider, model: cfg.model };
          try {
            const text = await collectFromOne(
              cfg,
              [{ role: "user", content: "Reply with just the word: OK" }],
              // Room for models that think before answering.
              { temperature: 0, maxTokens: 16 },
            );
            return { ...base, ok: true, reply: text.trim().slice(0, 100), ms: Date.now() - started };
          } catch (err) {
            return {
              ...base,
              ok: false,
              error: aiErrorMessage(err, req.log, "test"),
              ms: Date.now() - started,
            };
          }
        }),
      );
      return { results };
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
      const ai = getAiChain(req.user!.id);
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
          { temperature: 0.4, maxTokens: 900, onFallback: logFallback(req.log) },
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

  // The German for an English word in its sentence (translation exercises,
  // when the item's own words and the glossary don't have it).
  r.post(
    "/api/assistant/german-word",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["assistant"],
        body: germanWordBody,
        response: { 200: germanWord, 502: z.object({ error: z.string() }), 503: z.object({ error: z.string() }) },
      },
    },
    async (req, reply) => {
      const ai = getAiChain(req.user!.id);
      if (!ai) return reply.code(503).send({ error: NOT_SET_UP });
      const { system, user } = buildGermanWordMessages(req.body);
      try {
        const content = await collectCompletion(
          ai,
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { temperature: 0, maxTokens: 200, onFallback: logFallback(req.log) },
        );
        const obj = extractJsonObject(content);
        const parsed = obj ? germanWord.safeParse(obj) : null;
        if (!parsed?.success) return reply.code(502).send({ error: "could not read the tutor's reply — try again" });
        return parsed.data;
      } catch (err) {
        return reply.code(502).send({ error: aiErrorMessage(err, req.log, "german-word") });
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
      const ai = getAiChain(req.user!.id);
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
          { temperature: 0.2, maxTokens: 4096, onFallback: logFallback(req.log) },
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
  // Server-side proxy: the API key never reaches the browser. Streams tokens
  // back to the client as Server-Sent Events.
  r.post(
    "/api/assistant/ask",
    { preHandler: requireAuth, schema: { tags: ["assistant"], body: askBody } },
    async (req, reply) => {
      const ai = getAiChain(req.user!.id);
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
          onFallback: logFallback(req.log),
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
