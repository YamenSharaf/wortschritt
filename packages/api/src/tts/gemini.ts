import { Mp3Encoder } from "@breezystack/lamejs";
import { guardedFetch } from "../assistant/egress";

/**
 * Gemini text-to-speech (Google AI Studio key). Gemini returns raw 16-bit
 * PCM; it's encoded here to the same MP3 the other providers give (24 kHz,
 * 48 kbps, mono), so clips cache, play and join into story audio alike.
 */

const RATE = 24_000;
/** How every clip is read: for learners, calm and clear. */
const STYLE = "calm, clear and natural, at an unhurried pace, like a teacher reading to a learner";

/**
 * Over one of Google's limits (per minute or per day, on any tier); the
 * message says which, as Google does. `retryAfter` is how long Google says
 * to wait (seconds), if it says.
 */
export class GeminiLimitError extends Error {
  constructor(
    message: string,
    public retryAfter: number | null,
    /** A daily limit (it resets at midnight Pacific), and how many requests it allows, if Google says. */
    public daily = false,
    public quota: number | null = null,
  ) {
    super(message);
  }
}

/** One clip as MP3. */
export async function geminiSynthesize(text: string, voice: string, cfg: { key: string; model: string }): Promise<Buffer> {
  return pcmToMp3(await geminiPcm(text, voice, cfg));
}

/** Speech for `text` as Gemini gives it: 16-bit mono PCM at 24 kHz. Paragraphs (blank lines between) are read with a pause. */
export async function geminiPcm(text: string, voice: string, cfg: { key: string; model: string }): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    const res = await guardedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": cfg.key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text, speech_metadata: { style: STYLE } }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          responseFormat: { audio: { mimeType: "AUDIO_L16", sampleRate: RATE } },
          speechConfig: { voiceConfig: { voice } },
        },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (res.status === 429) {
      // Over a limit: wait if Google says it's soon, else give up for now.
      const body = await res.json().catch(() => null);
      const wait = retryDelay(body);
      if (attempt < 2 && wait !== null && wait <= 30) {
        await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
        continue;
      }
      const v = violation(body);
      const what = `${v?.quotaMetric ?? ""} ${v?.quotaId ?? ""}`.toLowerCase();
      const quota = Number(v?.quotaValue);
      throw new GeminiLimitError(limitReason(body, cfg.model), wait, /per_?day/.test(what), Number.isFinite(quota) && quota > 0 ? quota : null);
    }
    if (!res.ok) {
      const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
      throw new Error(`Gemini answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const body = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
    const data = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!data) throw new Error("Gemini returned no audio");
    return Buffer.from(data, "base64");
  }
}

/**
 * Which limit a 429 is about, from its QuotaFailure: "Gemini's daily limit
 * is used up (100 requests a day for gemini-3.8-flash-tts, Tier 1)".
 */
type Violation = { quotaMetric?: string; quotaId?: string; quotaValue?: string; description?: string };
/** The first QuotaFailure violation of a 429, if it has one. */
function violation(body: unknown): Violation | undefined {
  const details = (body as { error?: { details?: { "@type"?: string; violations?: Violation[] }[] } } | null)?.error?.details ?? [];
  return details.find((d) => d["@type"]?.endsWith("QuotaFailure"))?.violations?.[0];
}

export function limitReason(body: unknown, model: string): string {
  const v = violation(body);
  if (!v) return "Gemini's limit is used up for now";
  const what = `${v.quotaMetric ?? ""} ${v.quotaId ?? ""}`.toLowerCase();
  const per = /per_?day/.test(what) ? "day" : /per_?minute/.test(what) ? "minute" : null;
  const unit = /token/.test(what) ? "tokens" : "requests";
  const tier = /free\s*tier|freetier/i.test(`${v.description ?? ""} ${v.quotaId ?? ""}`)
    ? "free tier"
    : (/\b(tier \d)\b/i.exec(v.description ?? "")?.[1] ?? null);
  const amount = v.quotaValue ? `${v.quotaValue} ${unit} a ${per ?? "period"} for ${model}` : model;
  const which = per === "day" ? "daily limit" : per === "minute" ? "per-minute limit" : "limit";
  return `Gemini's ${which} is used up (${[amount, tier].filter(Boolean).join(", ")})`;
}

/** Seconds to wait from a 429's RetryInfo ("12s"), if it has one. */
export function retryDelay(body: unknown): number | null {
  const details = (body as { error?: { details?: { "@type"?: string; retryDelay?: string }[] } } | null)?.error?.details ?? [];
  const delay = details.find((d) => d["@type"]?.endsWith("RetryInfo"))?.retryDelay;
  const m = delay ? /^(\d+(?:\.\d+)?)s$/.exec(delay) : null;
  return m ? Math.ceil(Number(m[1])) : null;
}

/** 16-bit little-endian mono PCM at 24 kHz → MP3 (48 kbps). */
export function pcmToMp3(pcm: Buffer): Buffer {
  const samples = new Int16Array(pcm.byteLength >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2);
  const enc = new Mp3Encoder(1, RATE, 48);
  const parts: Buffer[] = [];
  const add = (b: Int8Array | Uint8Array) => b.length && parts.push(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
  for (let i = 0; i < samples.length; i += 1152) add(enc.encodeBuffer(samples.subarray(i, i + 1152)));
  add(enc.flush());
  return Buffer.concat(parts);
}
