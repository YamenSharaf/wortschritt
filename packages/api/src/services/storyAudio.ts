import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { and, asc, eq, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { chunkText, plainText, storyParagraphs, type StoryAudio } from "@mdb/shared";
import { db, schema } from "../db/client";
import { env } from "../env";
import { clip, isCached, liveSince } from "../tts/cache";
import { mp3Frames } from "../tts/mp3";
import { TtsRateLimited, usableVoices } from "../tts/providers";
import { getSettings } from "./settings";
import { getStory } from "./stories";

/**
 * A story as one audio file, for listening like an audiobook: made on demand
 * in the learner's reading voice from the same clips "Read aloud" uses (so
 * they're cached either way), joined, with where each paragraph starts.
 * Files are named by a hash of the voice and the text, so an edited story or
 * another voice makes a new one; the old one is simply no longer asked for.
 *
 * Stories are made one at a time from a queue in the database. When a
 * voice's (free) limit is reached, the story waits and carries on later by
 * itself, also after a restart; the clips made so far are cached. While
 * someone is using voices live (tapping words, reading aloud), the queue
 * pauses so it doesn't use up the limit they need.
 */

const dir = join(dirname(resolve(env.DATABASE_PATH)), "story-audio");

type Meta = { duration: number; starts: number[]; bytes: number };
type Job = { done: number; total: number; stop: boolean };
/** The story being made right now (one at a time). */
let running: { key: string; job: Job } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let log: FastifyBaseLogger | null = null;

const nowS = () => Math.floor(Date.now() / 1000);
/** Live use within this long pauses the queue. */
const LIVE_PAUSE_MS = 3 * 60_000;
/** A limit that doesn't say when it resets (a daily one): try again this often. */
const LIMIT_RETRY_S = 30 * 60;
/** When someone last checked on a story's audio (they're waiting for it: no pausing for them). */
const watched = new Map<string, number>();
const waitedFor = (key: string) => Date.now() - (watched.get(key) ?? 0) < 2 * 60_000;
const queued = (key: string) => db.select().from(schema.storyAudioQueue).where(eq(schema.storyAudioQueue.key, key)).get();

/** The reading voice as a usable server voice (else null: the device reads). */
export function readingVoice(userId: number): string | null {
  const s = getSettings(userId);
  const voice = s.readerVoice === "" ? s.ttsVoice : s.readerVoice === "device" ? "" : s.readerVoice;
  return voice && usableVoices().some((v) => v.id === voice) ? voice : null;
}

/** What's spoken for each paragraph (storyParagraphs order; "" for nothing to say). */
function spoken(body: string): string[] {
  return storyParagraphs(body).map((b) => {
    const t = plainText(b);
    return /\p{L}/u.test(t) ? t : "";
  });
}

const keyFor = (voice: string, paras: string[]) =>
  createHash("sha256").update(`${voice}\n${paras.join("\n\n")}`).digest("hex").slice(0, 32);
export const audioFile = (key: string) => join(dir, `${key}.mp3`);
const metaFile = (key: string) => join(dir, `${key}.json`);

function readMeta(key: string): Meta | null {
  try {
    return existsSync(audioFile(key)) ? (JSON.parse(readFileSync(metaFile(key), "utf8")) as Meta) : null;
  } catch {
    return null;
  }
}

const empty = (voice: string | null): StoryAudio => ({
  state: "none",
  voice,
  done: 0,
  total: 0,
  error: null,
  key: null,
  duration: 0,
  bytes: 0,
  starts: [],
  retryAt: null,
});

/** Where a story's audio stands for this learner; null when there's no such story. */
export function storyAudioStatus(userId: number, storyId: string): StoryAudio | null {
  const view = getStory(userId, storyId);
  if (!view) return null;
  const voice = readingVoice(userId);
  if (!voice) return empty(null);
  const paras = spoken(view.story.body);
  const key = keyFor(voice, paras);
  const meta = readMeta(key);
  if (meta) return { ...empty(voice), state: "ready", key, ...meta };
  watched.set(key, Date.now());
  if (running?.key === key) return { ...empty(voice), state: "building", done: running.job.done, total: running.job.total };
  const row = queued(key);
  if (!row) return empty(voice);
  const base = { ...empty(voice), done: row.done, total: row.total };
  if (row.error) return { ...base, state: "error", error: row.error };
  if (row.nextTryAt !== null && row.nextTryAt > nowS()) return { ...base, state: "waiting", retryAt: row.nextTryAt };
  return { ...base, state: "building" };
}

export class StoryAudioError extends Error {}

/** Queue a story's audio (once; asked again while it's being made it just reports; a failed or waiting one is tried again). */
export function startStoryAudio(userId: number, storyId: string, logger: FastifyBaseLogger): StoryAudio | null {
  log = logger;
  const view = getStory(userId, storyId);
  if (!view) return null;
  const voice = readingVoice(userId);
  if (!voice) throw new StoryAudioError("Choose a natural voice for reading aloud under Settings → Learning first.");
  const paras = spoken(view.story.body);
  const key = keyFor(voice, paras);
  if (!readMeta(key)) {
    watched.set(key, Date.now()); // asked for now: someone is waiting for it
    // An older version of this story (other text or voice) needn't be made any more.
    db.delete(schema.storyAudioQueue)
      .where(and(eq(schema.storyAudioQueue.userId, userId), eq(schema.storyAudioQueue.storyId, storyId), ne(schema.storyAudioQueue.key, key)))
      .run();
    const row = queued(key);
    if (!row) {
      const total = paras.map((p) => (p ? chunkText(p) : [])).flat().length;
      db.insert(schema.storyAudioQueue).values({ key, userId, storyId, voice, queuedAt: nowS(), nextTryAt: nowS(), total }).run();
    } else if (row.error || (row.nextTryAt ?? 0) > nowS()) {
      // Asked again: a failed or waiting story is tried at once (a limit still reached just waits again).
      db.update(schema.storyAudioQueue).set({ error: null, nextTryAt: nowS() }).where(eq(schema.storyAudioQueue.key, key)).run();
    }
    kick();
  }
  return storyAudioStatus(userId, storyId);
}

/** Carry on with the queue after a restart. */
export function resumeStoryAudio(logger: FastifyBaseLogger): void {
  log = logger;
  kick();
}

/** Make the next due story, if nothing else is being made; else wait for the next one due. */
function kick(): void {
  if (running) return;
  if (timer) clearTimeout(timer);
  timer = null;
  const q = schema.storyAudioQueue;
  const due = db.select().from(q).where(and(isNull(q.error), lte(q.nextTryAt, nowS()))).orderBy(asc(q.queuedAt)).get();
  if (!due) {
    const next = db.select().from(q).where(and(isNull(q.error), isNotNull(q.nextTryAt))).orderBy(asc(q.nextTryAt)).get();
    if (next) wake(next.nextTryAt! - nowS());
    return;
  }
  // Someone is using voices right now: leave the limit to them a while (unless they wait for this story).
  if (liveSince(LIVE_PAUSE_MS) && !waitedFor(due.key)) return wake(60);
  void run(due);
}

function wake(inSeconds: number): void {
  timer = setTimeout(kick, Math.min(Math.max(inSeconds, 1), 24 * 3600) * 1000);
  timer.unref?.();
}

class Paused extends Error {}

async function run(row: typeof schema.storyAudioQueue.$inferSelect): Promise<void> {
  const q = schema.storyAudioQueue;
  const view = getStory(row.userId, row.storyId);
  const paras = view ? spoken(view.story.body) : null;
  // Gone, or changed since (a new version is queued when it's asked for).
  if (!paras || keyFor(row.voice, paras) !== row.key) {
    db.delete(q).where(eq(q.key, row.key)).run();
    return kick();
  }
  const chunks = paras.map((p) => (p ? chunkText(p) : []));
  const job: Job = { done: 0, total: chunks.flat().length, stop: false };
  running = { key: row.key, job };
  try {
    await build(row.key, row.voice, chunks, job);
    db.delete(q).where(eq(q.key, row.key)).run();
    watched.delete(row.key);
  } catch (err) {
    const progress = { done: job.done, total: job.total };
    if (err instanceof TtsRateLimited) {
      const wait = Math.max(err.retryAfter ?? LIMIT_RETRY_S, 30);
      db.update(q).set({ ...progress, nextTryAt: nowS() + wait }).where(eq(q.key, row.key)).run();
      log?.info({ storyId: row.storyId, done: job.done, total: job.total, wait }, "story audio waits for the voice's limit");
    } else if (err instanceof Paused) {
      db.update(q).set({ ...progress, nextTryAt: nowS() + 90 }).where(eq(q.key, row.key)).run();
    } else {
      const error = err instanceof Error ? err.message.slice(0, 200) : "Couldn't make the audio.";
      db.update(q).set({ ...progress, error, nextTryAt: null }).where(eq(q.key, row.key)).run();
      log?.warn({ err, storyId: row.storyId }, "story audio failed");
    }
  } finally {
    running = null;
  }
  kick();
}

/** Synthesize every clip in order (a few at a time), join them, and keep the file and its timings. */
async function build(key: string, voice: string, chunks: string[][], job: Job): Promise<void> {
  const all = chunks.flatMap((cs, para) => cs.map((text) => ({ para, text })));
  const clips: Buffer[] = new Array(all.length);
  let next = 0;
  const worker = async () => {
    while (next < all.length && !job.stop) {
      const k = next++;
      const text = all[k]!.text;
      if (!isCached(text, voice) && liveSince(LIVE_PAUSE_MS) && !waitedFor(key)) throw new Paused();
      clips[k] = (await clip(text, voice, { background: true })).audio;
      job.done++;
    }
  };
  // The first failure stops the others; the clips under way still finish (and stay cached).
  const results = await Promise.allSettled(
    [worker(), worker(), worker()].map((w) =>
      w.catch((err) => {
        job.stop = true;
        throw err;
      }),
    ),
  );
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;

  const parts: Buffer[] = [];
  const starts: number[] = [];
  let t = 0;
  let k = 0;
  chunks.forEach((cs, para) => {
    starts[para] = Math.round(t * 1000) / 1000;
    for (let j = 0; j < cs.length; j++, k++) {
      const { data, seconds } = mp3Frames(clips[k]!);
      parts.push(data);
      t += seconds;
    }
  });
  const audio = Buffer.concat(parts);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(`${audioFile(key)}.tmp`, audio);
  writeFileSync(metaFile(key), JSON.stringify({ duration: Math.round(t * 1000) / 1000, starts, bytes: audio.length } satisfies Meta));
  renameSync(`${audioFile(key)}.tmp`, audioFile(key));
}

/** The file for a story's current audio, when `key` is still current. */
export function storyAudioPath(userId: number, storyId: string, key: string): { path: string; size: number } | null {
  const status = storyAudioStatus(userId, storyId);
  if (status?.state !== "ready" || status.key !== key) return null;
  const path = audioFile(key);
  return { path, size: statSync(path).size };
}
