import { storyParagraphs } from "@mdb/shared";

/**
 * A story's paragraphs as plain text for the spike's engines: Markdown
 * emphasis, headings, quotes and links reduced to their words.
 */
export function plainParagraphs(body: string): string[] {
  return storyParagraphs(body)
    .map((p) =>
      p
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^>\s?/gm, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(\*|_)(.+?)\1/g, "$2")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

/** "30 41 59" (a reader palette value) → "#1e293b". */
export function rgbHex(triplet: string): string {
  return `#${triplet
    .split(" ")
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Words and the bits between them, so each word can be tapped. */
export function tokens(text: string): { text: string; word: boolean }[] {
  return [...text.matchAll(/([\p{L}ß]+(?:-[\p{L}ß]+)*)|([^\p{L}ß]+)/gu)].map((m) => ({ text: m[0], word: Boolean(m[1]) }));
}
