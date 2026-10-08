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
  onMiss,
}: {
  children: ReactNode;
  className?: string;
  /** Language of the content, e.g. "de". */
  lang?: string;
  /** A tap that hit no word (and nothing interactive), e.g. to show/hide bars. */
  onMiss?: (e: React.MouseEvent) => void;
}) {
  const { canTap, openWord } = useVocab();

  function onClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("a,button,input,textarea,select,label,[data-no-tap]"))
      return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const hit = canTap ? wordAtPoint(e.clientX, e.clientY) : null;
    if (hit) openWord(hit.word, e.clientX, e.clientY, hit.context);
    else onMiss?.(e);
  }

  return (
    <div className={className} lang={lang} onClick={onClick}>
      {children}
    </div>
  );
}
