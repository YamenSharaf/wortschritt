/**
 * Find the word under a screen coordinate without wrapping every word in a
 * span. Uses the browser's caret hit-testing to locate the text node + offset,
 * then expands to word boundaries. Returns the word plus a bit of surrounding
 * text as translation context.
 */
export function wordAtPoint(
  x: number,
  y: number,
): { word: string; context: string } | null {
  const caret = caretFromPoint(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;

  const text = caret.node.textContent ?? "";
  const isLetter = (c: string | undefined) =>
    !!c && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(c); // Latin letters incl. ä ö ü ß

  let start = caret.offset;
  let end = caret.offset;
  while (start > 0 && isLetter(text[start - 1])) start--;
  while (end < text.length && isLetter(text[end])) end++;

  const word = text.slice(start, end).trim();
  if (word.length < 1 || !isLetter(word[0])) return null;

  const block = (caret.node.parentElement?.closest(
    "p,li,td,th,h1,h2,h3,h4,blockquote,figcaption,article,section,div",
  ) as HTMLElement | null)?.textContent;
  const context = (block ?? text).replace(/\s+/g, " ").trim().slice(0, 300);

  return { word, context };
}

type Caret = { node: Node; offset: number };

function caretFromPoint(x: number, y: number): Caret | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) return { node: p.offsetNode, offset: p.offset };
  }
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) return { node: r.startContainer, offset: r.startOffset };
  }
  return null;
}
