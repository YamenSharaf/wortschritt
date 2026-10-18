/**
 * Dragging words into order (sentence building): where a dropped word lands
 * among the words already in the answer, which wrap over several lines.
 */

export type Box = { x: number; y: number; width: number; height: number };

/**
 * The index to insert at, for a word dropped at `p` among `boxes` (the other
 * words of the answer, in reading order, as laid out). The line is the one
 * the point is on (or the nearest); within it, before the first word whose
 * middle is right of the point.
 */
export function dropIndex(boxes: Box[], p: { x: number; y: number }): number {
  if (boxes.length === 0) return 0;
  // Lines: runs of boxes sharing a row (a new line starts lower than the last box's middle).
  const lines: Array<{ start: number; end: number; top: number; bottom: number }> = [];
  boxes.forEach((b, i) => {
    const line = lines[lines.length - 1];
    if (line && b.y < line.top + (line.bottom - line.top) / 2) {
      line.end = i + 1;
      line.top = Math.min(line.top, b.y);
      line.bottom = Math.max(line.bottom, b.y + b.height);
    } else lines.push({ start: i, end: i + 1, top: b.y, bottom: b.y + b.height });
  });
  // Below the last line: at the end.
  const last = lines[lines.length - 1]!;
  if (p.y > last.bottom) return boxes.length;
  let line = lines[0]!;
  let best = Infinity;
  for (const l of lines) {
    const d = p.y < l.top ? l.top - p.y : p.y > l.bottom ? p.y - l.bottom : 0;
    if (d < best) {
      best = d;
      line = l;
    }
  }
  for (let i = line.start; i < line.end; i++) {
    const b = boxes[i]!;
    if (b.x + b.width / 2 > p.x) return i;
  }
  return line.end;
}

/**
 * The answer's word order after moving `token` to position `to` (counted
 * without it), or taking it out (`to` null). Tokens are indexes into the bank.
 */
export function moveWord(order: number[], token: number, to: number | null): number[] {
  const rest = order.filter((t) => t !== token);
  if (to === null) return rest;
  const at = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, at), token, ...rest.slice(at)];
}

/** Whether a point is over a box, with some slack around it. */
export function within(box: Box, p: { x: number; y: number }, slack = 0): boolean {
  return p.x >= box.x - slack && p.x <= box.x + box.width + slack && p.y >= box.y - slack && p.y <= box.y + box.height + slack;
}

/** A pointer that moved at least this far is dragging, not tapping. */
export const DRAG_SLOP = 6;
