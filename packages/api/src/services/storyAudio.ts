import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { chunkText, plainText, storyParagraphs, type StoryAudio } from "@mdb/shared";
import { env } from "../env";
import { clip } from "../tts/cache";
import { mp3Frames } from "../tts/mp3";
import { usableVoices } from "../tts/providers";
import { getSettings } from "./settings";
import { getStory } from "./stories";

/**
 * A story as one audio file, for listening like an audiobook: made on demand
 * in the learner's reading voice from the same clips "Read aloud" uses (so
 * they're cached either way), joined, with where each paragraph starts.
 * Files are named by a hash of the voice and the text, so an edited story or
 * another voice makes a new one; the old one is simply no longer asked for.
 */

const dir = join(dirname(resolve(env.DATABASE_PATH)), "story-audio");

type Meta = { duration: number; starts: number[]; bytes: number };
type Job = { done: number; total: number; error: string | null; running: boolean };
const jobs = new Map<string, Job>();

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
  const job = jobs.get(key);
  if (!job) return empty(voice);
  return { ...empty(voice), state: job.running ? "building" : "error", done: job.done, total: job.total, error: job.error };
}

export class StoryAudioError extends Error {}

/** Start making a story's audio (once; a second call while it's building just reports). */
export function startStoryAudio(userId: number, storyId: string, log: FastifyBaseLogger): StoryAudio | null {
  const view = getStory(userId, storyId);
  if (!view) return null;
  const voice = readingVoice(userId);
  if (!voice) throw new StoryAudioError("Choose a natural voice for reading aloud under Settings → Learning first.");
  const paras = spoken(view.story.body);
  const key = keyFor(voice, paras);
  if (!readMeta(key) && !jobs.get(key)?.running) {
    const chunks = paras.map((p) => (p ? chunkText(p) : []));
    const job: Job = { done: 0, total: chunks.flat().length, error: null, running: true };
    jobs.set(key, job);
    void build(key, voice, chunks, job).catch((err) => {
      job.running = false;
      job.error = err instanceof Error ? err.message.slice(0, 200) : "Couldn't make the audio.";
      log.warn({ err, storyId }, "story audio failed");
    });
  }
  return storyAudioStatus(userId, storyId);
}

/** Synthesize every clip in order (a few at a time), join them, and keep the file and its timings. */
async function build(key: string, voice: string, chunks: string[][], job: Job): Promise<void> {
  const all = chunks.flatMap((cs, para) => cs.map((text) => ({ para, text })));
  const clips: Buffer[] = new Array(all.length);
  let next = 0;
  const worker = async () => {
    while (next < all.length) {
      const k = next++;
      clips[k] = (await clip(all[k]!.text, voice)).audio;
      job.done++;
    }
  };
  await Promise.all([worker(), worker(), worker()]);

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
  jobs.delete(key);
}

/** The file for a story's current audio, when `key` is still current. */
export function storyAudioPath(userId: number, storyId: string, key: string): { path: string; size: number } | null {
  const status = storyAudioStatus(userId, storyId);
  if (status?.state !== "ready" || status.key !== key) return null;
  const path = audioFile(key);
  return { path, size: statSync(path).size };
}
