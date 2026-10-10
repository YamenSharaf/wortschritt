import { splitSentences, storyParagraphs, type ReaderSettings, type StoryView } from "@mdb/shared";
import { plainText } from "./text";

/**
 * What the reader lays out, in order: the header, then each paragraph's
 * German, with its English lines when they're on (under each sentence when
 * the sentences and lines match one to one, else under the paragraph).
 * Each piece is measured and paged on its own.
 */
export type Piece = {
  key: string;
  kind: "eyebrow" | "title" | "meta" | "de" | "en";
  /** The story paragraph it belongs to (storyParagraphs index); -1 for the header. */
  para: number;
  text: string;
  /** English left hidden ("peek") until tapped; `reveal` is its key for useStoryTranslations. */
  hidden?: boolean;
  reveal?: string;
  /** English being translated (a placeholder line). */
  loading?: boolean;
  /** Space after it, in multiples of the font size. */
  gapAfter: number;
};

export function storyPieces(o: {
  view: StoryView;
  translations: ReaderSettings["translations"];
  lines: Record<number, string[] | null>;
  translating: Set<number>;
  revealed: Set<string>;
}): Piece[] {
  const { view } = o;
  const story = view.story;
  const out: Piece[] = [];
  if (view.series) {
    out.push({ key: "eyebrow", kind: "eyebrow", para: -1, text: `Chapter ${view.series.chapter} of ${view.series.total}`, gapAfter: 0.2 });
  }
  out.push({ key: "title", kind: "title", para: -1, text: story.title, gapAfter: 0.25 });
  const meta = [story.subtitle, story.level, `${view.minutes} min`, view.readAt ? "read" : null].filter(Boolean).join(" · ");
  out.push({ key: "meta", kind: "meta", para: -1, text: meta, gapAfter: 1.4 });

  const on = o.translations !== "off";
  const peek = o.translations === "peek";
  const english = (key: string, para: number, text: string, gapAfter: number): Piece => ({
    key: `en-${key}`,
    kind: "en",
    para,
    text,
    hidden: peek && !o.revealed.has(key),
    reveal: key,
    gapAfter,
  });

  storyParagraphs(story.body).forEach((block, i) => {
    const text = plainText(block);
    if (!text) return;
    if (!on) {
      out.push({ key: `de-${i}`, kind: "de", para: i, text, gapAfter: 0.9 });
      return;
    }
    const sentences = splitSentences(block);
    const ls = o.lines[i] ?? null;
    if (ls && ls.length === sentences.length && sentences.length > 1) {
      sentences.forEach((s, j) => {
        const last = j === sentences.length - 1;
        out.push({ key: `de-${i}-${j}`, kind: "de", para: i, text: plainText(s), gapAfter: 0.1 });
        out.push(english(`${i}:${j}`, i, ls[j]!, last ? 0.9 : 0.45));
      });
      return;
    }
    const after = ls || o.translating.has(i);
    out.push({ key: `de-${i}`, kind: "de", para: i, text, gapAfter: after ? 0.15 : 0.9 });
    if (ls) out.push(english(`${i}:all`, i, ls.join(" "), 0.9));
    else if (o.translating.has(i)) out.push({ key: `en-${i}-loading`, kind: "en", para: i, text: "Translating…", loading: true, gapAfter: 0.9 });
  });
  return out;
}
