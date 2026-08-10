import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import type {
  SaveVocabBody,
  VocabEntry,
  VocabGroup,
  WordLookup,
} from "@mdb/shared";
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
  groups: VocabGroup[];
  /** Lowercased keys currently saved. */
  words: Set<string>;
  reload: () => void;
  save: (body: SaveVocabBody) => Promise<VocabEntry>;
  remove: (word: string) => Promise<void>;
  createGroup: (name: string) => Promise<VocabGroup>;
  deleteGroup: (id: number) => Promise<void>;
  setWordGroup: (word: string, id: number, member: boolean) => Promise<void>;
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
  const [groups, setGroups] = useState<VocabGroup[]>([]);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const reload = () => {
    api.vocab().then(setEntries).catch(() => {});
    api.vocabGroups().then(setGroups).catch(() => {});
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
    api.vocabGroups().then(setGroups).catch(() => {});
  }

  async function createGroup(name: string) {
    const g = await api.vocabGroupCreate(name);
    setGroups((prev) => [...prev, g].sort((a, b) => a.name.localeCompare(b.name)));
    return g;
  }

  async function deleteGroup(id: number) {
    await api.vocabGroupDelete(id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setEntries((prev) =>
      prev.map((e) => ({ ...e, groups: e.groups.filter((g) => g !== id) })),
    );
  }

  async function setWordGroup(word: string, id: number, member: boolean) {
    if (member) await api.vocabGroupAddWord(id, word);
    else await api.vocabGroupRemoveWord(id, word);
    const w = norm(word);
    setEntries((prev) =>
      prev.map((e) =>
        e.word !== w
          ? e
          : {
              ...e,
              groups: member
                ? [...new Set([...e.groups, id])]
                : e.groups.filter((g) => g !== id),
            },
      ),
    );
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== id ? g : { ...g, count: g.count + (member ? 1 : -1) },
      ),
    );
  }

  function openWord(display: string, x: number, y: number, context?: string) {
    setAnchor({ display, x, y, context, view: "menu" });
  }

  const value: VocabCtx = {
    enabled,
    entries,
    groups,
    words,
    reload,
    save,
    remove,
    createGroup,
    deleteGroup,
    setWordGroup,
    openWord,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {anchor && (
        <WordOverlay
          anchor={anchor}
          onTranslate={() => setAnchor({ ...anchor, view: "panel" })}
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
  onTranslate,
  onClose,
}: {
  anchor: Anchor;
  onTranslate: () => void;
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
          <WordMenu display={anchor.display} onTranslate={onTranslate} onClose={onClose} />
        ) : (
          <WordPanel display={anchor.display} context={anchor.context} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function WordMenu({
  display,
  onTranslate,
  onClose,
}: {
  display: string;
  onTranslate: () => void;
  onClose: () => void;
}) {
  const { words } = useVocab();
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
      {words.has(norm(display)) && (
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
  onClose,
}: {
  display: string;
  context?: string;
  onClose: () => void;
}) {
  const { entries, groups, save, setWordGroup, createGroup } = useVocab();
  const [fetched, setFetched] = useState<WordLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newGroup, setNewGroup] = useState("");

  // If the tapped surface form itself is already saved, use it (no AI call).
  const preSaved = entries.find((e) => e.word === norm(display));

  function load() {
    setLoading(true);
    setError(null);
    api
      .translateWord(display, { context, count: 2 })
      .then(setFetched)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (preSaved) return; // cached — no lookup
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, context]);

  const data: WordLookup | null = preSaved
    ? { lemma: preSaved.display, translation: preSaved.translation, examples: preSaved.examples }
    : fetched;
  // Save under the base form (e.g. "trifft" → "treffen").
  const headword = data?.lemma?.trim() || display;
  const savedEntry = entries.find((e) => e.word === norm(headword));
  const isSaved = !!savedEntry;
  const inflected = headword.toLowerCase() !== display.toLowerCase();

  async function ensureSaved() {
    if (isSaved || !data) return;
    await save({
      word: headword,
      display: headword,
      translation: data.translation,
      examples: data.examples,
    });
  }
  async function addPlain() {
    setSaving(true);
    try {
      await ensureSaved();
    } finally {
      setSaving(false);
    }
  }
  async function toggleGroup(id: number, member: boolean) {
    await ensureSaved();
    await setWordGroup(headword, id, member);
  }

  const ex = data?.examples?.[0];
  return (
    <div className="max-h-[70vh] overflow-y-auto p-3 font-content">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-base font-semibold">
          {headword}
          {inflected && (
            <span className="ml-1.5 text-xs font-normal text-slate-400">
              from “{display}”
            </span>
          )}
        </span>
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
        <div className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p>{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-1 font-medium underline"
          >
            Try again
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="text-sm text-slate-700 dark:text-slate-200">{data.translation}</p>
          {ex && (
            <div className="mt-2 rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800">
              <p className="text-slate-800 dark:text-slate-100">{ex.de}</p>
              <p className="text-slate-500">{ex.en}</p>
            </div>
          )}

          {groups.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-slate-400">
                {isSaved ? "Groups" : "Save to group"}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {groups.map((g) => {
                  const member = savedEntry?.groups.includes(g.id) ?? false;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => void toggleGroup(g.id, !member)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        member
                          ? "border-accent bg-accent text-accent-foreground"
                          : "border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-700"
                      }`}
                    >
                      {member ? "✓ " : ""}
                      {g.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const name = newGroup.trim();
              if (!name) return;
              const g = await createGroup(name);
              await toggleGroup(g.id, true);
              setNewGroup("");
            }}
            className="mt-2 flex items-center gap-1"
          >
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="＋ New group"
              className="w-28 rounded-full border border-dashed border-slate-300 bg-transparent px-2.5 py-1 text-xs outline-none focus:border-accent dark:border-slate-700"
            />
            {newGroup.trim() && (
              <button type="submit" className="text-xs font-medium text-accent">
                Add
              </button>
            )}
          </form>

          <div className="mt-3">
            {isSaved ? (
              <Link
                to="/vocab"
                onClick={onClose}
                className="block flex-1 rounded-lg bg-accent px-3 py-1.5 text-center text-sm font-medium text-accent-foreground"
              >
                ✓ Saved — open Vocab
              </Link>
            ) : (
              <button
                type="button"
                onClick={addPlain}
                disabled={saving}
                className="w-full rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
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
