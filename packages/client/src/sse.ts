import type { ByteReader } from "./http";

export type SseEvent = Record<string, unknown>;

/**
 * Parses a Server-Sent Events stream as it arrives, independent of how the
 * text gets here. Feed it decoded text; it calls `onEvent` with each `data:`
 * object and returns true once `[DONE]` is seen (ignore anything after).
 * An `{error}` event throws an Error with its message.
 */
export function createSseParser(onEvent: (data: SseEvent) => void): (text: string) => boolean {
  let buffer = "";
  return (text) => {
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim();
      if (data === "[DONE]") return true;
      let parsed: SseEvent;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (typeof parsed.error === "string") throw new Error(parsed.error);
      onEvent(parsed);
    }
    return false;
  };
}

type Decoder = { decode(input?: Uint8Array, opts?: { stream?: boolean }): string };

/** Read a byte stream to the end (or `[DONE]`), handing each event on. */
export async function readSse(reader: ByteReader, onEvent: (data: SseEvent) => void): Promise<void> {
  // TextDecoder exists in browsers and in Hermes; typed here without DOM libs.
  const decoder = new (globalThis as unknown as { TextDecoder: new () => Decoder }).TextDecoder();
  const feed = createSseParser(onEvent);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (feed(decoder.decode(value, { stream: true }))) return;
  }
}
