import type { FastifyBaseLogger } from "fastify";
import type { AiModelOption } from "@mdb/shared";
import type { AiConfig } from "./config";
import { EgressError, guardedFetch } from "./egress";

/**
 * Talks to a user's OpenAI-compatible endpoint, always in streaming mode (the
 * buffered variant is what tends to fail behind proxies and stream-only
 * gateways). Every request goes through the egress guard.
 */

/** An AI failure with a message that's safe to show the user. */
export class AiRequestError extends Error {
  constructor(
    public readonly publicMessage: string,
    public readonly detail?: unknown,
  ) {
    super(publicMessage);
  }
}

const TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type Message = { role: string; content: string };
type ChatChunk = { choices?: Array<{ delta?: { content?: string } }> };

/** Yields the text deltas of a chat completion from one entry. */
async function* streamOne(
  cfg: AiConfig,
  messages: Message[],
  opts: { temperature: number; maxTokens: number; signal?: AbortSignal },
): AsyncGenerator<string> {
  const signals = [AbortSignal.timeout(TIMEOUT_MS), ...(opts.signal ? [opts.signal] : [])];
  let upstream;
  try {
    upstream = await guardedFetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        stream: true,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        messages,
      }),
      signal: AbortSignal.any(signals),
    });
  } catch (err) {
    throw toAiError(err);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text().catch(() => "")).slice(0, 2000);
    throw new AiRequestError(`The AI provider answered ${upstream.status}.`, {
      status: upstream.status,
      detail,
    });
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  try {
    for await (const chunk of upstream.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new AiRequestError("The AI response was too large.");
      }
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const data = s.slice(5).trim();
        if (data === "[DONE]") return;
        let json: ChatChunk;
        try {
          json = JSON.parse(data) as ChatChunk;
        } catch {
          continue; // keep-alives and other non-JSON lines
        }
        const token = json?.choices?.[0]?.delta?.content;
        if (typeof token === "string" && token) yield token;
      }
    }
  } catch (err) {
    throw toAiError(err);
  }
}

/** Called when an entry fails and the next one is tried. */
export type OnFallback = (failed: AiConfig, error: AiRequestError) => void;

/**
 * Yields the text deltas of a chat completion, trying the user's entries in
 * order: if an entry fails before producing any text, the next one is tried.
 * Once text has started we stay with that entry (no mixed answers). When all
 * fail, the first entry's error is thrown.
 */
export async function* streamCompletion(
  chain: AiConfig[],
  messages: Message[],
  opts: { temperature: number; maxTokens: number; signal?: AbortSignal; onFallback?: OnFallback },
): AsyncGenerator<string> {
  let firstError: AiRequestError | null = null;
  for (const cfg of chain) {
    const stream = streamOne(cfg, messages, opts);
    let first: IteratorResult<string>;
    try {
      first = await stream.next();
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const e = toAiError(err);
      firstError ??= e;
      opts.onFallback?.(cfg, e);
      continue;
    }
    if (!first.done) yield first.value;
    yield* stream;
    return;
  }
  throw firstError ?? new AiRequestError("No AI model is set up.");
}

/** The whole completion as one string (with the same fallback). */
export async function collectCompletion(
  chain: AiConfig[],
  messages: Message[],
  opts: { temperature: number; maxTokens: number; signal?: AbortSignal; onFallback?: OnFallback },
): Promise<string> {
  let content = "";
  for await (const token of streamCompletion(chain, messages, opts)) content += token;
  return content;
}

/** One entry only, no fallback — for "Test connection". */
export function collectFromOne(
  cfg: AiConfig,
  messages: Message[],
  opts: { temperature: number; maxTokens: number },
): Promise<string> {
  return collectCompletion([cfg], messages, opts);
}

const MAX_MODELS_BYTES = 16 * 1024 * 1024;
const MAX_MODEL_PAGES = 10;

/** USD per token (OpenRouter's string format) → USD per 1M tokens. */
function perMillion(v: unknown): number | null {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : null;
}

/**
 * The provider's model list (`GET {baseUrl}/models`, the OpenAI-compatible
 * shape `{ data: [{ id, … }] }`). OpenRouter's extra fields (name, context
 * length, pricing) are used when present; its pages are followed.
 */
export async function listModels(provider: {
  baseUrl: string;
  apiKey: string | null;
}): Promise<AiModelOption[]> {
  const out: AiModelOption[] = [];
  let url: string | null = `${provider.baseUrl}/models`;
  let bytes = 0;
  for (let page = 0; url && page < MAX_MODEL_PAGES; page++) {
    let res;
    try {
      res = await guardedFetch(url, {
        headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw toAiError(err);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 2000);
      throw new AiRequestError(`The provider answered ${res.status}.`, { status: res.status, detail });
    }
    let text = "";
    const decoder = new TextDecoder();
    try {
      for await (const chunk of res.body!) {
        bytes += chunk.byteLength;
        if (bytes > MAX_MODELS_BYTES) throw new AiRequestError("The model list was too large.");
        text += decoder.decode(chunk, { stream: true });
      }
    } catch (err) {
      throw toAiError(err);
    }
    let json: { data?: unknown; links?: { next?: unknown } };
    try {
      json = JSON.parse(text);
    } catch {
      throw new AiRequestError("The provider doesn't offer a model list.");
    }
    if (!Array.isArray(json.data)) throw new AiRequestError("The provider doesn't offer a model list.");
    for (const m of json.data as Array<Record<string, unknown>>) {
      if (typeof m?.id !== "string" || !m.id) continue;
      const pricing = (m.pricing ?? {}) as Record<string, unknown>;
      out.push({
        id: m.id,
        name: typeof m.name === "string" && m.name !== m.id ? m.name : null,
        contextLength: typeof m.context_length === "number" ? m.context_length : null,
        promptPrice: perMillion(pricing.prompt),
        completionPrice: perMillion(pricing.completion),
      });
    }
    // OpenRouter paginates with links.next (a path or absolute URL on the same host).
    const next = typeof json.links?.next === "string" ? json.links.next : null;
    url = next ? new URL(next, provider.baseUrl).toString() : null;
    if (url && new URL(url).host !== new URL(provider.baseUrl).host) url = null;
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function toAiError(err: unknown): AiRequestError {
  if (err instanceof AiRequestError) return err;
  if (err instanceof EgressError) {
    return new AiRequestError(`This AI endpoint isn't allowed: ${err.message}.`, err);
  }
  // Walk `cause` chains: undici wraps connect/lookup errors.
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (e instanceof EgressError) {
      return new AiRequestError("This AI endpoint isn't allowed: it isn't a public address.", err);
    }
    if (e.name === "TimeoutError") return new AiRequestError("The AI provider took too long.", err);
  }
  return new AiRequestError("The AI request failed.", err);
}

/** Log the private detail of an AI failure; return the message for the user. */
export function aiErrorMessage(err: unknown, log: FastifyBaseLogger, what: string): string {
  const e = toAiError(err);
  log.error({ err: e.detail ?? err }, `${what} failed`);
  return e.publicMessage;
}
