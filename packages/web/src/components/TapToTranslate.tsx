import type { ReactNode } from "react";
import { useVocab } from "../lib/vocab";
import { wordAtPoint } from "../lib/wordAtPoint";

/**
 * Wraps content so a single tap/click on a word opens the translate menu.
 * Ignores taps on interactive elements and on an active text selection, so it
 * never gets in the way of answering, links, or copy-selecting.
 */
export function TapToTranslate({
  children,
  className,
  lang,
}: {
  children: ReactNode;
  className?: string;
  /** Language of the content, e.g. "de". */
  lang?: string;
}) {
  const { canTap, openWord } = useVocab();

  function onClick(e: React.MouseEvent) {
    if (!canTap) return;
    const target = e.target as HTMLElement;
    if (target.closest("a,button,input,textarea,select,label,[data-no-tap]"))
      return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const hit = wordAtPoint(e.clientX, e.clientY);
    if (hit) openWord(hit.word, e.clientX, e.clientY, hit.context);
  }

  return (
    <div className={className} lang={lang} onClick={onClick}>
      {children}
    </div>
  );
}
