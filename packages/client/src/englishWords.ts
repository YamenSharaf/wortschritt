import type { GermanWord } from "@mdb/shared";

/**
 * A translation exercise's English sentence, split for tapping: words (each
 * tappable), the text between them, and the item's own `words` found in it.
 * A preset is matched as a phrase, ignoring case and a leading "to"/"the"/"a"
 * ("to get up" finds "get up"); one that isn't in the sentence just stays in
 * the list of words.
 */
export type EnglishPart =
  | { kind: "text"; text: string }
  | { kind: "word"; text: string; preset?: { en: string; de: string } };

const WORD = /[\p{L}\p{N}'’-]+/gu;
const bare = (s: string) => s.trim().toLowerCase().replace(/^(to|the|a|an)\s+/, "");

export function englishParts(sentence: string, presets: { en: string; de: string }[] = []): EnglishPart[] {
  const tokens = [...sentence.matchAll(WORD)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
  // Longest presets first, so "look forward to" wins over "forward".
  // Each preset as written ("the holidays") and without its leading "to"/"the"/"a".
  const split = (s: string) => s.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const phrases = presets
    .flatMap((p) => [{ p, words: split(p.en) }, { p, words: split(bare(p.en)) }])
    .filter((x) => x.words.length > 0)
    .sort((a, b) => b.words.length - a.words.length);
  const parts: EnglishPart[] = [];
  let pos = 0;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    const hit = phrases.find((x) => x.words.every((w, k) => tokens[i + k]?.text.toLowerCase() === w));
    const last = hit ? tokens[i + hit.words.length - 1]! : t;
    if (t.start > pos) parts.push({ kind: "text", text: sentence.slice(pos, t.start) });
    parts.push({ kind: "word", text: sentence.slice(t.start, last.end), ...(hit ? { preset: hit.p } : {}) });
    pos = last.end;
    i += hit ? hit.words.length : 1;
  }
  if (pos < sentence.length) parts.push({ kind: "text", text: sentence.slice(pos) });
  return parts;
}

/** A preset word as a lookup result. */
export function presetAsGerman(p: { en: string; de: string }): GermanWord {
  const m = /^(der|die|das)\s+(.+)$/.exec(p.de);
  return { de: p.de, lemma: (m ? m[2]! : p.de).replace(/^sich\s+/, ""), en: p.en, ...(m ? { article: m[1]!, pos: "noun" } : {}) };
}
