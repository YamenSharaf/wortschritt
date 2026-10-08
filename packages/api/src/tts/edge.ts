import { createHash, randomBytes, randomUUID } from "node:crypto";
import { WebSocket } from "undici";

/**
 * Microsoft Edge "Read aloud" voices (the neural voices Edge uses), through
 * the endpoint the browser talks to. Unofficial — the same protocol the
 * `edge-tts` project uses — so it can change or be blocked at any time; the
 * app offers it as an option next to Piper and Azure, never as the only one.
 */
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
// Keep in step with edge-tts (its CHROMIUM_FULL_VERSION): Microsoft refuses old ones.
const CHROMIUM_VERSION = "143.0.3650.75";
const HOST = "speech.platform.bing.com";
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

/** Sec-MS-GEC: SHA-256 of the 5-minute-rounded Windows file time + token. */
export function secMsGec(nowMs = Date.now()): string {
  let ticks = Math.floor(nowMs / 1000) + 11_644_473_600;
  ticks -= ticks % 300;
  return createHash("sha256")
    .update(`${BigInt(ticks) * 10_000_000n}${TRUSTED_CLIENT_TOKEN}`)
    .digest("hex")
    .toUpperCase();
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** JavaScript's Date#toString in UTC, as the browser (and edge-tts) send it. */
function edgeTimestamp(d = new Date()): string {
  const [wd, day, mon, year, time] = d.toUTCString().replace(",", "").split(" ");
  return `${wd} ${mon} ${day} ${year} ${time} GMT+0000 (Coordinated Universal Time)`;
}

/** A percentage for <prosody rate>, e.g. 0.8 → "-20%". */
const ratePercent = (rate: number) => `${rate >= 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%`;

/** The audio in a binary frame (2-byte big-endian header length, header, data), or null. */
export function audioFromFrame(buf: Buffer): Buffer | null {
  if (buf.length < 2) return null;
  const headerLen = buf.readUInt16BE(0);
  const header = buf.subarray(2, 2 + headerLen).toString("utf8");
  return /(^|\r\n)Path:audio(\r\n|$)/.test(header) ? buf.subarray(2 + headerLen) : null;
}

/** Synthesize `text` with an Edge voice (e.g. "de-DE-KatjaNeural") as MP3. */
export function edgeSynthesize(text: string, voice: string, rate = 1): Promise<Buffer> {
  if (!/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/.test(voice)) {
    return Promise.reject(new Error(`unknown Edge voice "${voice}"`));
  }
  const url =
    `wss://${HOST}/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}&ConnectionId=${randomUUID().replace(/-/g, "")}`;
  const major = CHROMIUM_VERSION.split(".")[0];
  const ws = new WebSocket(url, {
    headers: {
      Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      // A random machine id, as the browser sends.
      Cookie: `muid=${randomBytes(16).toString("hex").toUpperCase()};`,
    },
  });
  ws.binaryType = "arraybuffer";

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      if (err) reject(err);
      else if (!size) reject(new Error("no audio received"));
      else resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => finish(new Error("timed out")), TIMEOUT_MS);

    ws.addEventListener("open", () => {
      const stamp = edgeTimestamp();
      ws.send(
        `X-Timestamp:${stamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
                  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
                },
              },
            },
          }),
      );
      const lang = voice.split("-").slice(0, 2).join("-");
      ws.send(
        `X-RequestId:${randomUUID().replace(/-/g, "")}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp}Z\r\nPath:ssml\r\n\r\n` +
          `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
          `<voice name='${voice}'><prosody pitch='+0Hz' rate='${ratePercent(rate)}' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>`,
      );
    });
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") {
        if (ev.data.includes("Path:turn.end")) finish(null);
        return;
      }
      const audio = audioFromFrame(Buffer.from(ev.data as ArrayBuffer));
      if (!audio) return;
      size += audio.length;
      if (size > MAX_BYTES) return finish(new Error("audio too large"));
      chunks.push(audio);
    });
    ws.addEventListener("error", (ev) => {
      const detail = (ev as unknown as { message?: string; error?: { message?: string } }).error?.message ?? (ev as unknown as { message?: string }).message;
      finish(new Error(`connection failed${detail ? `: ${detail}` : ""}`));
    });
    ws.addEventListener("close", () => finish(size ? null : new Error("closed before any audio")));
  });
}
