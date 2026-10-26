import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { and, asc, eq, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { chunkText, plainText, storyParagraphs, type PartialStoryAudio, type StoryAudio, type StoryAudioBrief, type StorySummary } from "@mdb/shared";
import { db, schema } from "../db/client";
import { env } from "../env";
import { cachedClipFile, clip, clipGroup, isCached, liveSince } from "../tts/cache";
import { mp3Frames } from "../tts/mp3";
import { backgroundRoom } from "../tts/geminiKeys";
import { groupsParagraphs, TtsRateLimited, usableVoices } from "../tts/providers";
import { getSettings } from "./settings";
import { getSeriesView, listSeries } from "./series";
import { getStory, listStories } from "./stories";

/**
 * A story as one audio file, for listening like an audiobook: made on demand
 * in the learner's reading voice from the same clips "Read aloud" uses (so
 * they're cached either way), joined, with where each paragraph starts.
 * Files are named by a hash of the voice and the text, so an edited story or
 * another voice makes a new one; the old one is simply no longer asked for.
 *
 * Stories are made one at a time from a queue in the database. When a
 * voice's limit is reached (per minute or per day, on any tier), every story
 * in that voice waits and carries on later by itself, also after a restart;
 * the clips made so far are cached, and the paragraphs made from the start
 * can be listened to meanwhile (partialStoryAudio). While someone is using
 * voices live (tapping words, reading aloud), the queue pauses so it doesn't
 * use up the limit they need. A voice whose limit counts requests (Gemini's)
 * is asked for several paragraphs at once, cut back apart in the pauses.
 *
 * Background audio (each learner's setting): when nothing else is due, the
 * server queues a story itself, for those whose reading voice is Gemini's: the
 * next chapters of books being read first, then the newest unread stories,
 * then (to listen to again) the ones already read.
 * Those go behind anything asked for, and use only the entries meant for
 * the background, within their share of the day (geminiKeys.ts).
 */

const dir = join(dirname(resolve(env.DATABASE_PATH)), "story-audio");

type Meta = { duration: number; starts: number[]; bytes: number };
/** A file of the first paragraphs, while the rest waits: of which full version, how many paragraphs. */
type PartialMeta = Meta & { of: string; paragraphs: number };
/** At most this much text in one request (about two minutes of speech), and this many clips. */
const GROUP_CHARS = 1500;
const GROUP_CLIPS = 12;
type Job = { done: number; total: number; stop: boolean };
/** The story being made right now (one at a time). */
let running: { key: string; job: Job } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let log: FastifyBaseLogger | null = null;

const nowS = () => Math.floor(Date.now() / 1000);
/** Live use within this long pauses the queue. */
let LIVE_PAUSE_MS = 3 * 60_000;
export function setLivePauseForTests(ms: number): void {
  LIVE_PAUSE_MS = ms;
}
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
  return voice && usableVoices(userId).some((v) => v.id === voice) ? voice : null;
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
  waitReason: null,
  readyParagraphs: 0,
  paragraphs: 0,
});

/** How many paragraphs from the start have all their clips made (they can be listened to). */
function readyFromStart(voice: string, paras: string[]): number {
  let n = 0;
  for (const p of paras) {
    if (p && !chunkText(p).every((c) => isCached(c, voice))) break;
    n++;
  }
  return n;
}

/**
 * Where a story's audio stands for this learner; null when there's no such
 * story. Asked by someone waiting for it (`watch`), it isn't paused for live use.
 */
export function storyAudioStatus(userId: number, storyId: string, watch = true): StoryAudio | null {
  const view = getStory(userId, storyId);
  if (!view) return null;
  return statusOf(readingVoice(userId), view.story.body, watch);
}

function statusOf(voice: string | null, body: string, watch: boolean): StoryAudio {
  if (!voice) return empty(null);
  const paras = spoken(body);
  const key = keyFor(voice, paras);
  const meta = readMeta(key);
  if (meta) return { ...empty(voice), state: "ready", key, ...meta };
  if (watch) watched.set(key, Date.now());
  // Only someone looking at this story needs to know how much of it can be heard already.
  const ready = watch ? { readyParagraphs: readyFromStart(voice, paras), paragraphs: paras.length } : {};
  if (running?.key === key) return { ...empty(voice), ...ready, state: "building", done: running.job.done, total: running.job.total };
  const row = queued(key);
  if (!row) return { ...empty(voice), ...ready };
  const base = { ...empty(voice), ...ready, done: row.done, total: row.total };
  if (row.error) return { ...base, state: "error", error: row.error };
  if (row.nextTryAt !== null && row.nextTryAt > nowS()) return { ...base, state: "waiting", retryAt: row.nextTryAt, waitReason: row.waitReason };
  return { ...base, state: "building" };
}

export class StoryAudioError extends Error {}

/** Every story's audio in short, by story id (for the story cards and a book's chapters). */
export function allStoryAudio(userId: number): Record<string, StoryAudioBrief> {
  const voice = readingVoice(userId);
  const out: Record<string, StoryAudioBrief> = {};
  for (const row of db.select({ id: schema.stories.id, data: schema.stories.data }).from(schema.stories).where(eq(schema.stories.userId, userId)).all()) {
    const body = (row.data as { body?: unknown } | null)?.body;
    if (typeof body !== "string") continue;
    const { state, done, total, duration, retryAt, waitReason } = statusOf(voice, body, false);
    out[row.id] = { state, done, total, duration, retryAt, waitReason };
  }
  return out;
}

/** Queue every written chapter of a book, in order; null when there's no such book. */
export function startSeriesAudio(userId: number, seriesId: string, logger: FastifyBaseLogger): Record<string, StoryAudioBrief> | null {
  const view = getSeriesView(userId, seriesId);
  if (!view) return null;
  for (const c of view.chapters) if (c.storyId) startStoryAudio(userId, c.storyId, logger, false);
  const all = allStoryAudio(userId);
  return Object.fromEntries(view.chapters.flatMap((c) => (c.storyId && all[c.storyId] ? [[c.storyId, all[c.storyId]!]] : [])));
}

/**
 * Queue a story's audio (once; asked again while it's being made it just
 * reports; a failed or waiting one is tried again). `waiting`: someone is
 * waiting to hear it now (else it's made in the background, like a book's).
 */
export function startStoryAudio(userId: number, storyId: string, logger: FastifyBaseLogger, waiting = true): StoryAudio | null {
  log = logger;
  const view = getStory(userId, storyId);
  if (!view) return null;
  const voice = readingVoice(userId);
  if (!voice) throw new StoryAudioError("Choose a natural voice for reading aloud under Settings → Learning first.");
  const paras = spoken(view.story.body);
  const key = keyFor(voice, paras);
  if (!readMeta(key)) {
    if (waiting) watched.set(key, Date.now());
    // An older version of this story (other text or voice) needn't be made any more.
    db.delete(schema.storyAudioQueue)
      .where(and(eq(schema.storyAudioQueue.userId, userId), eq(schema.storyAudioQueue.storyId, storyId), ne(schema.storyAudioQueue.key, key)))
      .run();
    const row = queued(key);
    // Asked for now: ahead of what the server queued by itself.
    if (row?.auto) db.update(schema.storyAudioQueue).set({ auto: false }).where(eq(schema.storyAudioQueue.key, key)).run();
    if (!row) {
      const total = paras.map((p) => (p ? chunkText(p) : [])).flat().length;
      db.insert(schema.storyAudioQueue).values({ key, userId, storyId, voice, queuedAt: nowS(), nextTryAt: nowS(), total }).run();
    } else if (row.error || (row.nextTryAt ?? 0) > nowS()) {
      // Asked again: a failed or waiting story is tried at once (a limit still reached just waits again).
      db.update(schema.storyAudioQueue).set({ error: null, nextTryAt: nowS() }).where(eq(schema.storyAudioQueue.key, key)).run();
    }
    kick();
  }
  return storyAudioStatus(userId, storyId, waiting);
}

/** At most this many stories queued by the server itself at a time. */
const AUTO_AT_ONCE = 2;
let lastFill = 0;

/**
 * Background audio: queue the next stories nobody asked for yet (see the
 * top), for each learner who switched it on and has room in today's
 * background requests, once the server's own ones are done; one done, the next follows at once. When
 * there was nothing to do, it looks again after ten minutes. Whether it
 * queued any.
 */
function fillBackground(): boolean {
  if (Date.now() - lastFill < 10 * 60_000) return false;
  const q = schema.storyAudioQueue;
  if (db.select().from(q).where(eq(q.auto, true)).get()) return false;
  const nothing = () => {
    lastFill = Date.now();
    return false;
  };
  let added = 0;
  for (const { id: userId } of db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.disabled, false)).orderBy(asc(schema.users.id)).all()) {
    // Each learner's own: switched on, a Gemini reading voice, and room left in their day.
    if (!getSettings(userId).audiobooks.auto) continue;
    const voice = readingVoice(userId);
    if (!voice || !groupsParagraphs(voice) || backgroundRoom(userId) <= 0) continue;
    for (const storyId of backgroundCandidates(userId)) {
      if (added >= AUTO_AT_ONCE) break;
      const view = getStory(userId, storyId);
      if (!view) continue;
      const paras = spoken(view.story.body);
      const key = keyFor(voice, paras);
      if (readMeta(key) || queued(key)) continue;
      const total = paras.map((p) => (p ? chunkText(p) : [])).flat().length;
      db.insert(q).values({ key, userId, storyId, voice, queuedAt: nowS(), nextTryAt: nowS(), total, auto: true }).run();
      log?.info({ storyId, userId }, "story audio queued in the background");
      added++;
      break; // one per learner per round, so everyone's get made
    }
  }
  return added > 0 || nothing();
}

/** Background audio was switched on (or changed): look for work now. */
export function wakeStoryAudio(): void {
  lastFill = 0;
  kick();
}

/**
 * A learner's stories in the order background audio makes them: the next
 * chapters of books being read, then the newest unread, then the read ones.
 */
export function backgroundCandidates(userId: number): string[] {
  const stories = listStories(userId);
  const reading = new Set(listSeries(userId).filter((s) => s.status === "reading").map((s) => s.id));
  const nextChapters = stories
    .filter((s) => s.seriesId && reading.has(s.seriesId) && s.status !== "read")
    .sort((a, b) => (a.seriesId === b.seriesId ? (a.chapter ?? 0) - (b.chapter ?? 0) : 0));
  const rest = stories.filter((s) => !nextChapters.includes(s));
  return [...nextChapters, ...newestFirst(rest.filter((s) => s.status !== "read")), ...newestFirst(rest.filter((s) => s.status === "read"))].map((s) => s.id);
}

/** Newest first; a book's chapters together and in their order (where the book's newest chapter falls). */
function newestFirst(list: StorySummary[]): StorySummary[] {
  const newestOf = new Map<string, number>();
  for (const s of list) if (s.seriesId) newestOf.set(s.seriesId, Math.max(newestOf.get(s.seriesId) ?? 0, s.createdAt));
  const at = (s: StorySummary) => (s.seriesId ? newestOf.get(s.seriesId)! : s.createdAt);
  return [...list].sort((a, b) => at(b) - at(a) || (a.seriesId ?? a.id).localeCompare(b.seriesId ?? b.id) || (a.chapter ?? 0) - (b.chapter ?? 0));
}

/** Whether story audio is queued or being made for this learner (it goes before their voice samples). */
export function storyAudioBusy(userId: number): boolean {
  const q = schema.storyAudioQueue;
  return Boolean(db.select({ key: q.key }).from(q).where(and(eq(q.userId, userId), isNull(q.error))).get());
}

export function resetBackgroundForTests(): void {
  lastFill = 0;
}

/** Carry on with the queue after a restart. */
export function resumeStoryAudio(logger: FastifyBaseLogger): void {
  log = logger;
  kick();
  // Background audio looks for work now and then, even with nothing queued.
  setInterval(kick, 10 * 60_000).unref?.();
}

/** Make the next due story, if nothing else is being made; else wait for the next one due. */
function kick(): void {
  if (running) return;
  if (timer) clearTimeout(timer);
  timer = null;
  const q = schema.storyAudioQueue;
  // Oldest first; a book's chapters, queued together, in their order.
  // What someone asked for first; then the oldest; a book's chapters, queued together, in their order.
  const due = db.select().from(q).where(and(isNull(q.error), lte(q.nextTryAt, nowS()))).orderBy(asc(q.auto), asc(q.queuedAt), sql`rowid`).get();
  if (!due) {
    if (fillBackground()) return kick();
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
  // Asked for by someone: no longer the server's own.
  if (row.auto && waitedFor(row.key)) db.update(q).set({ auto: false }).where(eq(q.key, row.key)).run();
  running = { key: row.key, job };
  try {
    await build(row.key, row.voice, chunks, job, row.userId);
    db.delete(q).where(eq(q.key, row.key)).run();
    watched.delete(row.key);
  } catch (err) {
    const progress = { done: job.done, total: job.total };
    if (err instanceof TtsRateLimited) {
      const wait = Math.max(err.retryAfter ?? LIMIT_RETRY_S, 30);
      db.update(q).set(progress).where(eq(q.key, row.key)).run();
      // The limit is this learner's keys' for the voice: their other stories in it wait too (rather than each spending a request to find out).
      db.update(q)
        .set({ nextTryAt: nowS() + wait, waitReason: err.message.slice(0, 300) })
        .where(and(eq(q.voice, row.voice), eq(q.userId, row.userId), isNull(q.error)))
        .run();
      log?.warn({ storyId: row.storyId, voice: row.voice, done: job.done, total: job.total, wait, reason: err.message }, "story audio waits for the voice's limit");
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

/**
 * The clips to ask for together: each one alone, or (a voice whose limit
 * counts requests) runs of clips not made yet, up to GROUP_CHARS of text.
 */
function plan(texts: string[], voice: string): number[][] {
  if (!groupsParagraphs(voice)) return texts.map((_, k) => [k]);
  const groups: number[][] = [];
  let cur: number[] = [];
  let chars = 0;
  const close = () => {
    if (cur.length) groups.push(cur);
    cur = [];
    chars = 0;
  };
  texts.forEach((t, k) => {
    if (isCached(t, voice)) {
      close();
      groups.push([k]);
      return;
    }
    if (cur.length && (chars + t.length > GROUP_CHARS || cur.length >= GROUP_CLIPS)) close();
    cur.push(k);
    chars += t.length;
  });
  close();
  return groups;
}

/** Synthesize every clip in order (a few requests at a time), join them, and keep the file and its timings. */
async function build(key: string, voice: string, chunks: string[][], job: Job, userId: number): Promise<void> {
  const all = chunks.flatMap((cs, para) => cs.map((text) => ({ para, text })));
  const texts = all.map((a) => a.text);
  const clips: Buffer[] = new Array(all.length);
  const groups = plan(texts, voice);
  let next = 0;
  const worker = async () => {
    while (next < groups.length && !job.stop) {
      const group = groups[next++]!;
      const made = group.every((k) => isCached(texts[k]!, voice));
      if (!made && liveSince(LIVE_PAUSE_MS) && !waitedFor(key)) throw new Paused();
      // Someone waiting for it may use the keys meant for that (a paid one); else the background's.
      const purpose = waitedFor(key) ? "waiting" : "background";
      const audio =
        group.length === 1
          ? [(await clip(texts[group[0]!]!, voice, userId, { purpose })).audio]
          : await clipGroup(group.map((k) => texts[k]!), voice, purpose, userId);
      group.forEach((k, i) => (clips[k] = audio[i]!));
      job.done += group.length;
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
  write(key, joinClips(chunks, clips));
}

/** Clips (in chunk order) joined into one file, with where each paragraph starts. */
function joinClips(chunks: string[][], clips: Buffer[]): { audio: Buffer; meta: Meta } {
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
  return { audio, meta: { duration: Math.round(t * 1000) / 1000, starts, bytes: audio.length } };
}

function write(key: string, { audio, meta }: { audio: Buffer; meta: Meta | PartialMeta }): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(`${audioFile(key)}.tmp`, audio);
  writeFileSync(metaFile(key), JSON.stringify(meta));
  renameSync(`${audioFile(key)}.tmp`, audioFile(key));
}

const partialKey = (key: string, paragraphs: number) => createHash("sha256").update(`${key}:${paragraphs}`).digest("hex").slice(0, 32);

/**
 * The paragraphs made so far, from the start, as one file (to listen to
 * while the rest waits); null when there's no such story, it's ready (use
 * the whole file), or not even its first paragraph is made yet.
 */
export function partialStoryAudio(userId: number, storyId: string): PartialStoryAudio | null {
  const view = getStory(userId, storyId);
  const voice = readingVoice(userId);
  if (!view || !voice) return null;
  const paras = spoken(view.story.body);
  const key = keyFor(voice, paras);
  if (readMeta(key)) return null;
  const n = readyFromStart(voice, paras);
  if (n === 0 || !paras.slice(0, n).some(Boolean)) return null;
  const pkey = partialKey(key, n);
  let meta = readMeta(pkey) as PartialMeta | null;
  if (!meta) {
    const chunks = paras.slice(0, n).map((p) => (p ? chunkText(p) : []));
    const clips = chunks.flat().map((c) => readFileSync(cachedClipFile(c, voice)));
    const joined = joinClips(chunks, clips);
    meta = { ...joined.meta, of: key, paragraphs: n };
    write(pkey, { audio: joined.audio, meta });
  }
  return { key: pkey, duration: meta.duration, starts: meta.starts, paragraphs: n, of: paras.length };
}

/** The file for a story's current audio, when `key` is still current. */
export function storyAudioPath(userId: number, storyId: string, key: string): { path: string; size: number } | null {
  const status = storyAudioStatus(userId, storyId);
  if (!status) return null;
  if (status.state !== "ready" || status.key !== key) {
    // The first paragraphs of the version being made, while the rest waits.
    const view = getStory(userId, storyId);
    const meta = readMeta(key) as PartialMeta | null;
    if (!view || !status.voice || meta?.of !== keyFor(status.voice, spoken(view.story.body))) return null;
  }
  const path = audioFile(key);
  return { path, size: statSync(path).size };
}
