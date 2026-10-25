/**
 * Cutting one recording of several paragraphs back into one clip each.
 * Gemini's limit counts requests, not length, so story audio asks for a few
 * paragraphs at a time; to keep each paragraph's own clip (for the reader's
 * highlighting and for "Read aloud", which reuses them), the audio is cut in
 * the pauses between them. Where a cut should be is guessed from the text
 * (speech takes about as long as its letters), then moved to the clearest
 * pause near there.
 */

/** Analysis window: 10 ms at 24 kHz. */
const WIN = 240;
/** A pause is at least this many silent windows (120 ms). */
const MIN_PAUSE = 12;
/** The pause after a paragraph takes about as long as saying this many letters. */
const PAUSE_LETTERS = 12;

/**
 * Where to cut 16-bit mono PCM into `weights.length` parts (sample indexes,
 * one fewer than parts, ascending). `weights` are the parts' text lengths.
 */
export function pauseCuts(pcm: Int16Array, weights: number[]): number[] {
  const parts = weights.length;
  if (parts < 2) return [];
  const n = Math.floor(pcm.length / WIN);
  if (n < parts * 2) return evenCuts(pcm.length, weights);

  // Loudness per window, and what counts as quiet: well under typical speech.
  const level = new Float64Array(n);
  for (let w = 0; w < n; w++) {
    let sum = 0;
    for (let i = w * WIN; i < (w + 1) * WIN; i++) sum += Math.abs(pcm[i]!);
    level[w] = sum / WIN;
  }
  const sorted = Array.from(level).sort((a, b) => a - b);
  const speech = sorted[Math.floor(n * 0.8)]!;
  const quiet = Math.max(speech * 0.08, 30);

  // The pauses: runs of quiet windows (not the silence before the first word or after the last).
  const pauses: { mid: number; len: number }[] = [];
  let start = -1;
  for (let w = 0; w <= n; w++) {
    const silent = w < n && level[w]! < quiet;
    if (silent && start < 0) start = w;
    if (!silent && start >= 0) {
      if (w - start >= MIN_PAUSE && start > 0 && w < n) pauses.push({ mid: Math.floor((start + w) / 2), len: w - start });
      start = -1;
    }
  }

  // Where each cut should be by the text (letters, plus a pause's worth for each part)…
  const sized = weights.map((w) => w + PAUSE_LETTERS);
  const total = sized.reduce((a, b) => a + b, 0);
  const options: { at: number; cost: number }[][] = [];
  let before = 0;
  for (let j = 0; j < parts - 1; j++) {
    before += sized[j]!;
    const expected = (n * before) / total;
    const reach = Math.max((n * Math.min(sized[j]!, sized[j + 1]!)) / total, 150); // at least 1.5 s either way
    // …and the pauses near there: near the guess counts most, a longer pause (a paragraph's end) helps.
    const near = pauses
      .filter((p) => Math.abs(p.mid - expected) <= reach)
      .map((p) => ({ at: p.mid, cost: Math.abs(p.mid - expected) / reach - Math.min(p.len, 60) / 60 }));
    // No pause near: cut at the guess (costly, so a pause is taken whenever one fits).
    options.push([...near, { at: Math.round(expected), cost: 2 }]);
  }

  // The cheapest choice of one option per cut with the cuts in order (each part at least 100 ms).
  const best: { cost: number; from: number }[][] = options.map((opts) => opts.map(() => ({ cost: Infinity, from: -1 })));
  options[0]!.forEach((o, k) => o.at > 10 && (best[0]![k] = { cost: o.cost, from: -1 }));
  for (let j = 1; j < options.length; j++) {
    options[j]!.forEach((o, k) => {
      options[j - 1]!.forEach((p, i) => {
        const c = best[j - 1]![i]!.cost + o.cost;
        if (o.at > p.at + 10 && c < best[j]![k]!.cost) best[j]![k] = { cost: c, from: i };
      });
    });
  }
  const last = options.length - 1;
  let k = best[last]!.reduce((bi, b, i, all) => (b.cost < all[bi]!.cost && options[last]![i]!.at < n - 10 ? i : bi), 0);
  if (!Number.isFinite(best[last]![k]!.cost)) return evenCuts(pcm.length, weights);
  const cuts: number[] = [];
  for (let j = last; j >= 0; j--) {
    cuts.unshift(options[j]![k]!.at);
    k = best[j]![k]!.from;
  }
  return cuts.map((w) => w * WIN);
}

/** Cuts by text length alone (too little audio to find pauses in). */
function evenCuts(samples: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const cuts: number[] = [];
  let before = 0;
  for (let j = 0; j < weights.length - 1; j++) {
    before += weights[j]!;
    cuts.push(Math.round((samples * before) / total));
  }
  return cuts;
}

/** The parts of 16-bit PCM between the cuts. */
export function splitPcm(pcm: Buffer, weights: number[]): Buffer[] {
  const samples = new Int16Array(pcm.byteLength >> 1); // a copy: the buffer may not be 2-byte aligned
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2);
  const cuts = [0, ...pauseCuts(samples, weights), samples.length];
  return weights.map((_, i) => pcm.subarray(cuts[i]! * 2, cuts[i + 1]! * 2));
}
