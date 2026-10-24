import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { env } from "../env";
import { synthesize } from "./providers";

// Synthesized clips live on the app's own data volume (no sharing needed).
const cacheDir = join(dirname(resolve(env.DATABASE_PATH)), "tts-cache");

/** When a clip was last made for someone listening right now (not in the background). */
let lastLive = 0;
/** Whether clips were made for someone listening within the last `ms`. */
export const liveSince = (ms: number) => Date.now() - lastLive < ms;

const fileFor = (text: string, voice: string) => join(cacheDir, `${createHash("sha256").update(`${voice}\n${text}`).digest("hex")}.mp3`);
/** Whether this clip is made already (costs nothing to use). */
export const isCached = (text: string, voice: string) => existsSync(fileFor(text, voice));

/**
 * A cached clip for this voice and text, or a fresh one (then cached).
 * `background` (story audio from the queue) doesn't count as live use.
 */
export async function clip(text: string, voice: string, opts: { background?: boolean } = {}): Promise<{ audio: Buffer; type: string }> {
  const file = fileFor(text, voice);
  if (existsSync(file)) return { audio: readFileSync(file), type: "audio/mpeg" };
  if (!opts.background) lastLive = Date.now();
  const out = await synthesize(text, voice);
  try {
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    if (out.ext === "mp3") writeFileSync(file, out.audio);
  } catch {
    /* caching is best-effort */
  }
  return out;
}
