/**
 * How a story's Markdown is cut up for reading: paragraphs (blank-line
 * blocks, also the read-aloud units) and sentences (for line-by-line
 * translation). Shared so the server's translations line up with what the
 * reader shows.
 */

/** Blank-line separated blocks, trimmed. */
export function storyParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** Running text (not a heading, list, quote, table, rule or code). */
export function isProse(block: string): boolean {
  return !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|---|\*\*\*$)/.test(block);
}

// "z. B.", "Dr.", "Nr." … don't end a sentence.
const ABBREVIATIONS = new Set([
  "z", "b", "d", "h", "u", "a", "usw", "bzw", "dr", "nr", "ca", "evtl", "ggf", "inkl", "vgl", "str", "hr", "fr", "prof", "st", "bspw",
]);

/**
 * The sentences of a prose block (other blocks are one unit). Splits after
 * . ! ? … (plus closing quotes) before an upper-case letter or opening quote,
 * but not after abbreviations or ordinals ("am 3. Mai").
 */
export function splitSentences(block: string): string[] {
  if (!isProse(block)) return [block];
  const text = block.replace(/\s*\n\s*/g, " ").trim();
  const out: string[] = [];
  let start = 0;
  const re = /[.!?…]+["“”»«‘’'*_)]*(?=\s+["„“»«‘(*_]*[\p{Lu}0-9])/gu;
  for (const m of text.matchAll(re)) {
    const end = m.index! + m[0].length;
    const before = text.slice(start, m.index!).split(/\s+/).pop() ?? "";
    const word = before.replace(/^[^\p{L}\d]+/u, "").toLowerCase();
    if (m[0].startsWith(".") && m[0].length === 1 && (ABBREVIATIONS.has(word) || /^\d+$/.test(word))) continue;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Markdown emphasis, links and markers removed (for sending to an AI, or for speech). */
export function plainText(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+|^[-*+]\s+|^>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .trim();
}

/** Split text into chunks of at most `max` characters at sentence ends
 *  (server clips cap at 500; long device utterances get cut off too). */
export function chunkText(text: string, max = 480): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]+["“”»«]*\s*|[^.!?…]+$/g) ?? [];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    // A single overlong sentence: split it hard.
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
      continue;
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}
