import { useEffect, useRef, useState } from "react";
import { api, askAssistant } from "../lib/api";
import { TutorMarkdown } from "./TutorMarkdown";
import { CrossIcon, SparklesIcon } from "./icons";
import { btn } from "./ui";

type Anchor = { text: string; x: number; y: number };

/**
 * App-wide tutor. Highlight any text → an "Explain" chip appears → opens a
 * panel that streams an explanation. Renders nothing when the server has no
 * assistant configured. The API key lives server-side; this only talks to
 * our own /api/assistant endpoint.
 */
export function SelectionAssistant() {
  const [enabled, setEnabled] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api
      .assistantStatus()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    function onMouseUp(e: MouseEvent) {
      // Don't hijack selections made inside the tutor panel itself.
      if (panelRef.current?.contains(e.target as Node)) return;
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!text || !sel || sel.rangeCount === 0) {
        setAnchor(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setAnchor({ text, x: rect.left + rect.width / 2, y: rect.top });
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [enabled]);

  if (!enabled) return null;

  function run(sel: string, q: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setAnswer("");
    askAssistant(
      { selection: sel, question: q || undefined },
      (t) => setAnswer((a) => a + t),
      controller.signal,
    )
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => setBusy(false));
  }

  function openWith(text: string) {
    setSelection(text);
    setQuestion("");
    setOpen(true);
    setAnchor(null);
    run(text, "");
  }

  function close() {
    abortRef.current?.abort();
    setOpen(false);
  }

  return (
    <>
      {anchor && !open && (
        <button
          type="button"
          // preventDefault keeps the text selection alive through the click
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openWith(anchor.text)}
          style={{
            position: "fixed",
            left: anchor.x,
            top: Math.max(8, anchor.y - 40),
            transform: "translateX(-50%)",
          }}
          className="ws-dock z-50 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink"
        >
          <SparklesIcon className="h-3.5 w-3.5 text-brand-ink" />
          Explain
        </button>
      )}

      {open && (
        <div
          ref={panelRef}
          className="fixed bottom-20 right-4 z-50 flex max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] flex-col rounded-card border border-line bg-surface shadow-pop md:bottom-4"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2 ">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><SparklesIcon className="h-4 w-4 text-brand-ink" />Tutor</span>
            <button
              type="button"
              onClick={close}
              className="text-ink-subtle hover:text-ink"
              aria-label="Close"
            >
              <CrossIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-3">
            <blockquote className="mb-3 border-l-2 border-line-control pl-3 text-sm italic text-ink-muted ">
              {selection.length > 240 ? selection.slice(0, 240) + "…" : selection}
            </blockquote>
            {error ? (
              <p className="text-sm text-danger">{error}</p>
            ) : (
              <TutorMarkdown text={answer} busy={busy} />
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) run(selection, question.trim());
            }}
            className="flex gap-2 border-t border-line p-3 "
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a follow-up…"
              className="flex-1 rounded-lg border border-line-control bg-transparent px-3 py-1.5 text-sm outline-none focus:border-focus "
            />
            <button
              type="submit"
              disabled={busy || !question.trim()}
              className={`${btn.primary} ${btn.sm}`}
            >
              Ask
            </button>
          </form>
        </div>
      )}
    </>
  );
}
