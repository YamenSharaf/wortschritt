import { test } from "node:test";
import assert from "node:assert/strict";
import { pauseCuts, splitPcm } from "./split";

const RATE = 24_000;

/** "Speech" (a tone with a wobble, like syllables) for each length in seconds, with pauses between. */
function recording(parts: number[], pause: number, shortPauses = 0): { pcm: Int16Array; gaps: [number, number][] } {
  const out: number[] = [];
  const gaps: [number, number][] = [];
  const silence = (s: number) => {
    for (let i = 0; i < s * RATE; i++) out.push(Math.round((Math.random() - 0.5) * 20)); // a little room noise
  };
  silence(0.3);
  parts.forEach((secs, p) => {
    const n = secs * RATE;
    for (let i = 0; i < n; i++) {
      // Short dips inside a part (between words), quieter than speech but not silent for long.
      const word = Math.floor(i / (0.35 * RATE));
      const inGap = shortPauses && i % (0.35 * RATE) < 0.05 * RATE && word > 0;
      out.push(inGap ? 0 : Math.round(8000 * Math.sin((2 * Math.PI * 180 * i) / RATE) * (0.6 + 0.4 * Math.sin(i / 900))));
    }
    if (p < parts.length - 1) {
      const start = out.length;
      silence(pause);
      gaps.push([start, out.length]);
    }
  });
  silence(0.3);
  return { pcm: Int16Array.from(out), gaps };
}

test("cuts land in the pauses between paragraphs, even when the text's lengths mislead", () => {
  // Three paragraphs; the text says 1:1:1 but they take 4 s, 2 s and 6 s.
  const { pcm, gaps } = recording([4, 2, 6], 0.6, 1);
  const cuts = pauseCuts(pcm, [100, 100, 100]);
  assert.equal(cuts.length, 2);
  cuts.forEach((c, i) => assert.ok(c >= gaps[i]![0] && c <= gaps[i]![1], `cut ${i} at ${c} is in the pause ${gaps[i]}`));
});

test("many short paragraphs: one cut in each pause, in order", () => {
  const lengths = [1.5, 2, 1, 3, 1.2, 2.5, 1.8];
  const { pcm, gaps } = recording(lengths, 0.45, 1);
  const cuts = pauseCuts(pcm, lengths.map((s) => Math.round(s * 15)));
  assert.equal(cuts.length, lengths.length - 1);
  cuts.forEach((c, i) => assert.ok(c >= gaps[i]![0] && c <= gaps[i]![1], `cut ${i}`));
  assert.deepEqual([...cuts].sort((a, b) => a - b), cuts);
});

test("no pauses at all: cut by text length; one part: no cuts", () => {
  const pcm = Int16Array.from({ length: RATE * 3 }, (_, i) => Math.round(8000 * Math.sin(i / 20)));
  const cuts = pauseCuts(pcm, [100, 200]);
  assert.equal(cuts.length, 1);
  assert.ok(Math.abs(cuts[0]! - RATE) < RATE * 0.1, String(cuts[0]));
  assert.deepEqual(pauseCuts(pcm, [5]), []);
});

test("splitPcm: the parts put back together are the whole recording", () => {
  const { pcm } = recording([1, 1, 1], 0.5);
  const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const parts = splitPcm(buf, [1, 1, 1]);
  assert.equal(parts.length, 3);
  assert.ok(Buffer.concat(parts).equals(buf));
  // An odd offset (a Buffer from a shared pool) works too.
  const odd = Buffer.alloc(buf.length + 1);
  buf.copy(odd, 1);
  assert.ok(Buffer.concat(splitPcm(odd.subarray(1), [1, 1, 1])).equals(buf));
});
