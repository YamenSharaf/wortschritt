import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoryAudio } from "@mdb/shared";
import { audioProgressText, listeningProgress, paragraphAt, prepareStoryAudio } from "./storyAudio";

const base: StoryAudio = { state: "none", voice: "v", done: 0, total: 0, error: null, key: null, duration: 0, bytes: 0, starts: [], retryAt: null, waitReason: null, readyParagraphs: 0, paragraphs: 0 };

test("paragraphAt: the last paragraph started (an empty one is passed over)", () => {
  const starts = [0, 2.5, 6, 6, 9];
  assert.equal(paragraphAt(starts, 0), 0);
  assert.equal(paragraphAt(starts, 2.49), 1, "a moment early counts");
  assert.equal(paragraphAt(starts, 7), 3);
  assert.equal(paragraphAt(starts, 100), 4);
});

test("prepareStoryAudio: starts it, reports progress until ready, or says why not", async () => {
  const seen: string[] = [];
  let polls = 0;
  const ready = await prepareStoryAudio(
    {
      storyAudio: async () => (++polls < 3 ? { ...base, state: polls === 1 ? "none" : "building", done: 2, total: 4 } : { ...base, state: "ready", key: "k" }),
      startStoryAudio: async () => ({ ...base, state: "building", done: 0, total: 4 }),
    },
    "s",
    { interval: 1, onProgress: (p) => seen.push(`${p.done}/${p.total}`) },
  );
  assert.equal(ready.key, "k");
  assert.deepEqual(seen, ["0/4", "2/4"]);
  await assert.rejects(
    prepareStoryAudio({ storyAudio: async () => base, startStoryAudio: async () => ({ ...base, state: "error", error: "Azure said no" }) }, "s"),
    /Azure said no/,
  );
});

test("prepareStoryAudio: waits while the voice's limit is reached (the server carries on)", async () => {
  const seen: (number | null)[] = [];
  let polls = 0;
  const ready = await prepareStoryAudio(
    {
      storyAudio: async () =>
        ++polls < 3 ? { ...base, state: "waiting", done: 2, total: 4, retryAt: 1_000 } : { ...base, state: "ready", key: "k" },
      startStoryAudio: async () => ({ ...base, state: "waiting", done: 2, total: 4, retryAt: 1_000 }),
    },
    "s",
    { interval: 1, waitingInterval: 1, onProgress: (p) => seen.push(p.retryAt) },
  );
  assert.equal(ready.key, "k");
  assert.deepEqual(seen, [1_000, 1_000]);
  assert.equal(audioProgressText({ done: 2, total: 4, retryAt: null }), "Preparing the audio… · 2 of 4");
  assert.equal(
    audioProgressText({ done: 2, total: 4, retryAt: 1_000 + 25 * 60 }, 1_000_000),
    "Waiting for the voice's limit · 2 of 4 · carries on by itself in 25 min",
  );
  assert.match(
    audioProgressText({ done: 2, total: 4, retryAt: 1_000 + 6 * 3600, reason: "Gemini's daily limit is used up (100 requests a day)" }, 1_000_000),
    /^Gemini's daily limit is used up \(100 requests a day\) · 2 of 4 · carries on by itself at \d{1,2}[:.]\d{2}/,
  );
});

test("listeningProgress: one report per paragraph heard, the end as read, nothing for partial audio", () => {
  const sent: unknown[] = [];
  const heard = listeningProgress({ storyProgress: async (_id: string, p: number, spot?: unknown) => (sent.push([p, spot]), { ok: true as const }) });
  const story = { id: "s", starts: [0, 10, 30], duration: 40, partial: false };
  heard(story, 2);
  heard(story, 5);
  heard(story, 12);
  heard(story, 0, true);
  heard({ ...story, partial: true }, 31);
  assert.deepEqual(sent, [
    [0, { para: 0, char: 0 }],
    [0.25, { para: 1, char: 0 }],
    [1, undefined],
  ]);
});
