import type { FastifyBaseLogger } from "fastify";
import { asc, eq } from "drizzle-orm";
import { VOICE_SAMPLES } from "@mdb/shared";
import { db, schema } from "../db/client";
import { storyAudioBusy } from "../services/storyAudio";
import { clip, isCached, liveSince } from "./cache";
import { TtsRateLimited } from "./errors";
import { backgroundRoom } from "./geminiKeys";
import { offeredVoices } from "./providers";

/** Gemini samples made per round at most (each is a request off a daily limit). */
const GEMINI_PER_ROUND = 2;
/** Someone using voices this recently: Gemini samples wait. */
let LIVE_PAUSE_MS = 3 * 60_000;
export function setSamplesLivePauseForTests(ms: number): void {
  LIVE_PAUSE_MS = ms;
}

let busy = false;

/**
 * The voice pickers' samples (VOICE_SAMPLES), made ahead of time so trying
 * a voice plays at once: Edge and Azure ones straight away (quick, and Edge
 * is free); Gemini ones a couple at a time, only with keys a learner allows
 * for background use, and only once their story audio is done, so they never
 * take requests reading needs. Made once, kept in the clip cache for everyone.
 */
export async function makeVoiceSamples(log?: FastifyBaseLogger): Promise<number> {
  if (busy) return 0;
  busy = true;
  let made = 0;
  let gemini = 0;
  try {
    const users = db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.disabled, false)).orderBy(asc(schema.users.id)).all();
    for (const { id: userId } of users) {
      let geminiOk = true;
      for (const voice of await offeredVoices(userId).catch(() => [])) {
        for (const text of Object.values(VOICE_SAMPLES)) {
          if (isCached(text, voice.id)) continue;
          if (voice.provider === "gemini") {
            if (!geminiOk || gemini >= GEMINI_PER_ROUND || liveSince(LIVE_PAUSE_MS) || storyAudioBusy(userId) || backgroundRoom(userId) <= 0) continue;
            gemini++;
          }
          try {
            await clip(text, voice.id, userId, { purpose: "background" });
            made++;
          } catch (err) {
            // A limit: this learner's Gemini keys are done for now (the next round tries again).
            if (voice.provider === "gemini" && err instanceof TtsRateLimited) geminiOk = false;
            else log?.warn({ voice: voice.id, err: err instanceof Error ? err.message : String(err) }, "voice sample failed");
          }
        }
      }
    }
  } finally {
    busy = false;
  }
  if (made) log?.info({ made }, "voice samples made");
  return made;
}

/** Make missing samples now and every 10 minutes (new voices, keys, or room in the day). */
export function startVoiceSamples(log: FastifyBaseLogger): void {
  void makeVoiceSamples(log);
  setInterval(() => void makeVoiceSamples(log), 10 * 60_000).unref?.();
}
