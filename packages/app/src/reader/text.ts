/**
 * Markdown reduced to its words (emphasis, headings, quotes and links), for
 * one paragraph or sentence of a story.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** "30 41 59" (a reader palette value) → "#1e293b"; with `alpha` (0–1) → "#1e293b80". */
export function rgbHex(triplet: string, alpha?: number): string {
  const hex = triplet
    .split(" ")
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}${alpha === undefined ? "" : Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

/** Words and the bits between them, so each word can be tapped. */
export function tokens(text: string): { text: string; word: boolean }[] {
  return [...text.matchAll(/([\p{L}ß]+(?:-[\p{L}ß]+)*)|([^\p{L}ß]+)/gu)].map((m) => ({ text: m[0], word: Boolean(m[1]) }));
}

/** The sentence around character `at` of `text` (context for the AI translation of a tapped word). */
export function sentenceAround(text: string, at: number): string {
  const before = text.slice(0, at);
  const start = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? ")) + 1;
  const rest = text.slice(at);
  const m = rest.search(/[.!?…](\s|$)/);
  return text.slice(start, m < 0 ? text.length : at + m + 1).trim();
}
