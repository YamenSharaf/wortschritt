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

/** Over the free tier's limit; `retryAfter` is how long Google says to wait (seconds), if it says. */
export class GeminiLimitError extends Error {
  constructor(
    message: string,
    public retryAfter: number | null,
  ) {
    super(message);
  }
}

export async function geminiSynthesize(text: string, voice: string, cfg: { key: string; model: string }): Promise<Buffer> {
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
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 429) {
      // Over the free tier's rate: wait if Google says it's soon, else give up for now.
      const wait = retryDelay(await res.json().catch(() => null));
      if (attempt < 2 && wait !== null && wait <= 30) {
        await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
        continue;
      }
      throw new GeminiLimitError("Gemini's limit is used up for now; try again later", wait);
    }
    if (!res.ok) {
      const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
      throw new Error(`Gemini answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const body = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
    const data = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!data) throw new Error("Gemini returned no audio");
    return pcmToMp3(Buffer.from(data, "base64"));
  }
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
