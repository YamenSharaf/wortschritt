import type { FastifyBaseLogger } from "fastify";
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

/** Yields the text deltas of a chat completion. */
export async function* streamCompletion(
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

/** The whole completion as one string. */
export async function collectCompletion(
  cfg: AiConfig,
  messages: Message[],
  opts: { temperature: number; maxTokens: number; signal?: AbortSignal },
): Promise<string> {
  let content = "";
  for await (const token of streamCompletion(cfg, messages, opts)) content += token;
  return content;
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
