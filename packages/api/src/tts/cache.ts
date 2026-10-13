import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { env } from "../env";
import { synthesize } from "./providers";

// Synthesized clips live on the app's own data volume (no sharing needed).
const cacheDir = join(dirname(resolve(env.DATABASE_PATH)), "tts-cache");

/** A cached clip for this voice and text, or a fresh one (then cached). */
export async function clip(text: string, voice: string): Promise<{ audio: Buffer; type: string }> {
  const key = createHash("sha256").update(`${voice}\n${text}`).digest("hex");
  const file = join(cacheDir, `${key}.mp3`);
  if (existsSync(file)) return { audio: readFileSync(file), type: "audio/mpeg" };
  const out = await synthesize(text, voice);
  try {
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, `${key}.${out.ext}`), out.audio);
  } catch {
    /* caching is best-effort */
  }
  return out;
}
