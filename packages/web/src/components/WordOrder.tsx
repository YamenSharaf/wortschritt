import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DRAG_SLOP, dropIndex, moveWord, within } from "@mdb/client";

type Drag = {
  token: number;
  /** Pointer position, and where on the word it was grabbed. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  width: number;
  height: number;
  /** Where it would land in the answer (null: back to the bank). */
  to: number | null;
};

/**
 * Sentence building with a word bank: tap a word to add it at the end (or
 * to take it out of the answer), or drag it to its place; the other words
 * make room as it moves. Dragging out of the answer puts a word back.
 */
export function WordOrder({
  tokens,
  chosen,
  onChange,
  disabled,
}: {
  tokens: string[];
  /** The answer so far: indexes into `tokens`. */
  chosen: number[];
  onChange: (order: number[]) => void;
  disabled: boolean;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const answerBox = useRef<HTMLDivElement>(null);
  const chips = useRef(new Map<string, HTMLElement>());
  const latest = useRef({ chosen, drag });
  latest.current = { chosen, drag };
  /** A drag just ended: the click that follows isn't a tap. */
  const justDragged = useRef(false);
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  const order = drag ? chosen.filter((t) => t !== drag.token) : chosen;
  const remaining = tokens.map((_, i) => i).filter((i) => !chosen.includes(i));
  useFlip(chips, [order.join(","), drag?.to, remaining.join(",")]);

  function landing(p: { x: number; y: number }, token: number): number | null {
    const area = answerBox.current?.getBoundingClientRect();
    if (!area || !within(area, p, 24)) return null;
    const boxes = latest.current.chosen
      .filter((t) => t !== token)
      .map((t) => chips.current.get(`a${t}`)?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r);
    return dropIndex(boxes, p);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>, token: number) {
    if (disabled || e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const rect = e.currentTarget.getBoundingClientRect();
    let dragging = false;
    const move = (ev: PointerEvent) => {
      const p = { x: ev.clientX, y: ev.clientY };
      if (!dragging) {
        if (Math.hypot(p.x - start.x, p.y - start.y) < DRAG_SLOP) return;
        dragging = true;
      }
      ev.preventDefault();
      setDrag({
        token,
        x: p.x,
        y: p.y,
        dx: start.x - rect.left,
        dy: start.y - rect.top,
        width: rect.width,
        height: rect.height,
        to: landing(p, token),
      });
    };
    const up = () => {
      stop.current();
      const d = latest.current.drag;
      if (!dragging || !d) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      setDrag(null);
      const next = moveWord(latest.current.chosen, d.token, d.to);
      if (next.join(",") !== latest.current.chosen.join(",")) onChange(next);
    };
    stop.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const tap = (fn: () => void) => () => {
    if (!justDragged.current) fn();
  };
  const ref = (key: string) => (el: HTMLElement | null) => {
    if (el) chips.current.set(key, el);
    else chips.current.delete(key);
  };
  const chipBase = "touch-none select-none rounded-[8px] border px-3 py-1";

  const answerChips = order.map((t) => (
    <button
      key={`a${t}`}
      ref={ref(`a${t}`)}
      type="button"
      disabled={disabled}
      onPointerDown={(e) => onPointerDown(e, t)}
      onClick={tap(() => onChange(chosen.filter((c) => c !== t)))}
      className={`${chipBase} cursor-grab border-transparent bg-brand-soft font-medium text-brand-ink disabled:cursor-default`}
    >
      {tokens[t]}
    </button>
  ));
  if (drag && drag.to !== null) {
    answerChips.splice(
      drag.to,
      0,
      <span
        key="gap"
        aria-hidden
        style={{ width: drag.width, height: drag.height }}
        className="rounded-[8px] border border-dashed border-brand bg-brand-soft/40"
      />,
    );
  }

  return (
    <>
      <div
        ref={answerBox}
        className={`mb-3 min-h-12 rounded-control border border-dashed p-2 transition-colors ${
          drag && drag.to !== null ? "border-brand bg-brand-soft/20" : "border-line-control bg-surface-sunken"
        }`}
      >
        <div className="flex flex-wrap gap-2">{answerChips}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {remaining.map((i) => (
          <button
            key={`b${i}`}
            ref={ref(`b${i}`)}
            type="button"
            disabled={disabled}
            onPointerDown={(e) => onPointerDown(e, i)}
            onClick={tap(() => onChange([...chosen, i]))}
            // The word being dragged leaves its place in the bank open.
            className={`${chipBase} cursor-grab border-line-control bg-surface hover:bg-surface-sunken disabled:cursor-default ${
              drag?.token === i ? "invisible" : ""
            }`}
          >
            {tokens[i]}
          </button>
        ))}
      </div>
      {drag && (
        <div
          aria-hidden
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width, height: drag.height }}
          className="pointer-events-none fixed z-50 scale-105 rounded-[8px] bg-surface shadow-lg"
        >
          <div className="flex h-full items-center justify-center rounded-[8px] bg-brand-soft px-3 py-1 font-medium text-brand-ink">
            {tokens[drag.token]}
          </div>
        </div>
      )}
    </>
  );
}

/** Words glide to their new places when the layout changes (first, last, invert, play). */
function useFlip(chips: React.RefObject<Map<string, HTMLElement>>, deps: unknown[]) {
  const before = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const now = new Map<string, DOMRect>();
    for (const [key, el] of chips.current) {
      const r = el.getBoundingClientRect();
      now.set(key, r);
      const old = before.current.get(key);
      if (!old) continue;
      const dx = old.left - r.left;
      const dy = old.top - r.top;
      if (!dx && !dy) continue;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth;
      el.style.transition = "transform 160ms ease-out";
      el.style.transform = "";
    }
    before.current = now;
  }, deps);
}
