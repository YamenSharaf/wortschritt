import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import type { SaveVocabBody, VocabEntry, WordLookup } from "@mdb/shared";
import { api } from "./api";

const norm = (w: string) => w.trim().toLowerCase();

type Anchor = {
  display: string;
  x: number;
  y: number;
  context?: string;
  view: "menu" | "panel";
};

type VocabCtx = {
  /** Whether the AI tutor is configured (word lookup needs it). */
  enabled: boolean;
  entries: VocabEntry[];
  /** Lowercased keys currently saved. */
  words: Set<string>;
  reload: () => void;
  save: (body: SaveVocabBody) => Promise<VocabEntry>;
  remove: (word: string) => Promise<void>;
  openWord: (display: string, x: number, y: number, context?: string) => void;
};

const Ctx = createContext<VocabCtx | null>(null);

export function useVocab(): VocabCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useVocab must be used within VocabProvider");
  return ctx;
}

export function VocabProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const reload = () => {
    api.vocab().then(setEntries).catch(() => {});
  };

  useEffect(() => {
    api
      .assistantStatus()
      .then((s) => setEnabled(s.enabled))
      .catch(() => {});
    reload();
  }, []);

  const words = useMemo(() => new Set(entries.map((e) => e.word)), [entries]);

  async function save(body: SaveVocabBody) {
    const entry = await api.vocabSave(body);
    setEntries((prev) =>
      [entry, ...prev.filter((e) => e.word !== entry.word)].sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    );
    return entry;
  }

  async function remove(word: string) {
    await api.vocabRemove(word);
    setEntries((prev) => prev.filter((e) => e.word !== norm(word)));
  }

  function openWord(display: string, x: number, y: number, context?: string) {
    setAnchor({ display, x, y, context, view: "menu" });
  }

  const value: VocabCtx = {
    enabled,
    entries,
    words,
    reload,
    save,
    remove,
    openWord,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {anchor && (
        <WordOverlay
          anchor={anchor}
          saved={words.has(norm(anchor.display))}
          savedEntry={entries.find((e) => e.word === norm(anchor.display))}
          onTranslate={() => setAnchor({ ...anchor, view: "panel" })}
          onSave={save}
          onClose={() => setAnchor(null)}
        />
      )}
    </Ctx.Provider>
  );
}

// --- floating menu + translate panel ---------------------------------------

function anchorStyle(x: number, y: number): React.CSSProperties {
  const width = 300;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(8, Math.min(x - width / 2, vw - width - 8));
  const above = y > vh * 0.55;
  return above
    ? { left, bottom: vh - y + 16, width }
    : { left, top: y + 16, width };
}

function WordOverlay({
  anchor,
  saved,
  savedEntry,
  onTranslate,
  onSave,
  onClose,
}: {
  anchor: Anchor;
  saved: boolean;
  savedEntry?: VocabEntry;
  onTranslate: () => void;
  onSave: (b: SaveVocabBody) => Promise<VocabEntry>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        style={anchorStyle(anchor.x, anchor.y)}
        onClick={(e) => e.stopPropagation()}
      >
        {anchor.view === "menu" ? (
          <WordMenu
            display={anchor.display}
            saved={saved}
            onTranslate={onTranslate}
            onClose={onClose}
          />
        ) : (
          <WordPanel
            display={anchor.display}
            context={anchor.context}
            saved={saved}
            savedEntry={savedEntry}
            onSave={onSave}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function WordMenu({
  display,
  saved,
  onTranslate,
  onClose,
}: {
  display: string;
  saved: boolean;
  onTranslate: () => void;
  onClose: () => void;
}) {
  const item =
    "flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800";
  return (
    <div className="flex items-stretch divide-x divide-slate-200 dark:divide-slate-700">
      <button type="button" onClick={onTranslate} className={item}>
        🌐 Translate
      </button>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(display).catch(() => {});
          onClose();
        }}
        className={item}
      >
        📋 Copy
      </button>
      {saved && (
        <Link to="/vocab" onClick={onClose} className={item}>
          ✓ In vocab
        </Link>
      )}
    </div>
  );
}

function WordPanel({
  display,
  context,
  saved,
  savedEntry,
  onSave,
  onClose,
}: {
  display: string;
  context?: string;
  saved: boolean;
  savedEntry?: VocabEntry;
  onSave: (b: SaveVocabBody) => Promise<VocabEntry>;
  onClose: () => void;
}) {
  const [data, setData] = useState<WordLookup | null>(
    savedEntry
      ? { translation: savedEntry.translation, examples: savedEntry.examples }
      : null,
  );
  const [loading, setLoading] = useState(!savedEntry);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(saved);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (savedEntry) return; // already have cached data — no AI call
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .translateWord(display, context, 2)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [display, context, savedEntry]);

  async function add() {
    if (!data) return;
    setSaving(true);
    try {
      await onSave({
        word: display,
        display,
        translation: data.translation,
        examples: data.examples,
      });
      setJustSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const ex = data?.examples?.[0];
  return (
    <div className="p-3 font-content">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-base font-semibold">{display}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          ✕
        </button>
      </div>
      {loading && <p className="py-2 text-sm text-slate-500">Translating…</p>}
      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {data && (
        <>
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {data.translation}
          </p>
          {ex && (
            <div className="mt-2 rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800">
              <p className="text-slate-800 dark:text-slate-100">{ex.de}</p>
              <p className="text-slate-500">{ex.en}</p>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            {justSaved ? (
              <Link
                to="/vocab"
                onClick={onClose}
                className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-center text-sm font-medium text-accent-foreground"
              >
                ✓ Saved — open Vocab
              </Link>
            ) : (
              <button
                type="button"
                onClick={add}
                disabled={saving}
                className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
              >
                {saving ? "Adding…" : "＋ Add to vocab"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
