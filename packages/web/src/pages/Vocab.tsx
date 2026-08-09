import { useEffect, useState } from "react";
import type { VocabEntry } from "@mdb/shared";
import { api } from "../lib/api";
import { timeAgo } from "../lib/time";
import { useVocab } from "../lib/vocab";

export function VocabPage() {
  const { entries, reload, save, remove, enabled } = useVocab();
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Vocab</h1>
      <p className="mb-4 text-sm text-slate-500">
        Words you saved by tapping them in cheat sheets, exercises, or the tutor.
      </p>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No words yet. Tap any word in a cheat sheet or exercise and choose{" "}
          <span className="font-medium">🌐 Translate → ＋ Add to vocab</span>.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {entries.map((e) => (
            <VocabRow
              key={e.word}
              entry={e}
              open={open === e.word}
              onToggle={() => setOpen(open === e.word ? null : e.word)}
              onRefresh={save}
              onRemove={remove}
              canRefresh={enabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VocabRow({
  entry,
  open,
  onToggle,
  onRefresh,
  onRemove,
  canRefresh,
}: {
  entry: VocabEntry;
  open: boolean;
  onToggle: () => void;
  onRefresh: (b: {
    word: string;
    display: string;
    translation: string;
    examples: { de: string; en: string }[];
  }) => Promise<VocabEntry>;
  onRemove: (word: string) => Promise<void>;
  canRefresh: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const d = await api.translateWord(entry.display, undefined, 2);
      await onRefresh({
        word: entry.word,
        display: entry.display,
        translation: d.translation,
        examples: d.examples,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <span className="w-1/3 shrink-0 font-medium">{entry.display}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-500">
          {entry.translation}
        </span>
        <span className="shrink-0 text-xs text-slate-400">
          {timeAgo(entry.createdAt)}
        </span>
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 font-content dark:border-slate-800">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {entry.translation}
          </p>
          <div className="mt-2 space-y-2">
            {entry.examples.map((ex, i) => (
              <div
                key={i}
                className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800"
              >
                <p className="text-slate-800 dark:text-slate-100">{ex.de}</p>
                <p className="text-slate-500">{ex.en}</p>
              </div>
            ))}
            {entry.examples.length === 0 && (
              <p className="text-sm text-slate-400">No examples saved.</p>
            )}
          </div>
          {error && (
            <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={busy || !canRefresh}
              title={canRefresh ? "" : "AI tutor not configured"}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:border-slate-500 disabled:opacity-50 dark:border-slate-700"
            >
              {busy ? "Refreshing…" : "↻ New examples"}
            </button>
            <button
              type="button"
              onClick={() => void onRemove(entry.word)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:border-red-400 dark:border-slate-700"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
