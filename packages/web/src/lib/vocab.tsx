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
  DictEntry,
  SaveVocabBody,
  VocabEntry,
  VocabGroup,
  WordLookup,
} from "@mdb/shared";
import { SpeakButton } from "../components/SpeakButton";
import { api } from "./api";
import { speak, ttsSupported } from "./tts";

const norm = (w: string) => w.trim().toLowerCase();

type Anchor = {
  display: string;
  x: number;
  y: number;
  context?: string;
  view: "menu" | "panel";
};

type VocabCtx = {
  /** Whether the AI tutor is configured (the fuller word lookup needs it). */
  enabled: boolean;
  /** Whether the bundled offline dictionary is loaded (instant gloss on tap). */
  dictAvailable: boolean;
  /** Either source lets a tap open the word menu. */
  canTap: boolean;
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
  /** Record a flashcard grade; updates the word's kept score. */
  recordStudy: (word: string, known: boolean) => Promise<void>;
  /** Clear a word's flashcard score. */
  resetStudy: (word: string) => Promise<void>;
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
  const [dictAvailable, setDictAvailable] = useState(false);
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
    api
      .dictStatus()
      .then((s) => setDictAvailable(s.available))
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

  async function recordStudy(word: string, known: boolean) {
    const w = norm(word);
    const stats = await api.studyVocab(w, known);
    setEntries((prev) =>
      prev.map((e) => (e.word === w ? { ...e, stats } : e)),
    );
  }

  async function resetStudy(word: string) {
    const w = norm(word);
    await api.resetVocabStudy(w);
    setEntries((prev) =>
      prev.map((e) => (e.word === w ? { ...e, stats: null } : e)),
    );
  }

  function openWord(display: string, x: number, y: number, context?: string) {
    setAnchor({ display, x, y, context, view: "menu" });
  }

  const value: VocabCtx = {
    enabled,
    dictAvailable,
    canTap: enabled || dictAvailable,
    entries,
    groups,
    words,
    reload,
    save,
    remove,
    createGroup,
    deleteGroup,
    setWordGroup,
    recordStudy,
    resetStudy,
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

const POS_LABEL: Record<string, string> = {
  verb: "verb",
  noun: "noun",
  adj: "adjective",
  adv: "adverb",
  prep: "preposition",
  conj: "conjunction",
  pron: "pronoun",
  det: "determiner",
  num: "number",
  interj: "interjection",
};

function WordOverlay({
  anchor,
  onTranslate,
  onClose,
}: {
  anchor: Anchor;
  onTranslate: () => void;
  onClose: () => void;
}) {
  const { enabled } = useVocab();
  // undefined = still looking up; null = no offline entry.
  const [dict, setDict] = useState<DictEntry | null | undefined>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setDict(undefined);
    api
      .dict(anchor.display)
      .then((d) => alive && setDict(d))
      .catch(() => alive && setDict(null));
    return () => {
      alive = false;
    };
  }, [anchor.display]);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        style={anchorStyle(anchor.x, anchor.y)}
        onClick={(e) => e.stopPropagation()}
      >
        {anchor.view === "menu" ? (
          <WordMenu
            display={anchor.display}
            dict={dict}
            aiEnabled={enabled}
            onTranslate={onTranslate}
            onClose={onClose}
          />
        ) : (
          <WordPanel
            display={anchor.display}
            context={anchor.context}
            dict={dict ?? null}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

/** The instant offline gloss shown at the top of the tap menu. */
function DictGloss({
  display,
  dict,
  aiEnabled,
}: {
  display: string;
  dict: DictEntry | null | undefined;
  aiEnabled: boolean;
}) {
  if (dict === undefined) {
    return (
      <div className="px-3 py-2 text-xs text-slate-400">Looking up…</div>
    );
  }
  if (dict === null) return null;
  const inflected = dict.lemma.toLowerCase() !== display.toLowerCase();
  const head = dict.article ? `${dict.article} ${dict.lemma}` : dict.lemma;
  return (
    <div className="border-b border-slate-200 px-3 py-2 font-content dark:border-slate-700">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">{head}</span>
        {dict.pos && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800">
            {POS_LABEL[dict.pos] ?? dict.pos}
          </span>
        )}
        <SpeakButton text={dict.lemma} className="-my-1" />
      </div>
      {inflected && (
        <div className="text-xs text-slate-400">from “{display}”</div>
      )}
      {dict.gloss ? (
        <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">
          {dict.gloss}
        </p>
      ) : (
        <p className="mt-0.5 text-xs text-slate-400">
          {aiEnabled ? "Tap Translate for the meaning." : "No offline definition."}
        </p>
      )}
      {dict.pos === "noun" && dict.plural && (
        <p className="text-xs text-slate-400">pl. {dict.plural}</p>
      )}
    </div>
  );
}

function WordMenu({
  display,
  dict,
  aiEnabled,
  onTranslate,
  onClose,
}: {
  display: string;
  dict: DictEntry | null | undefined;
  aiEnabled: boolean;
  onTranslate: () => void;
  onClose: () => void;
}) {
  const item =
    "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800";
  return (
    <div>
      <DictGloss display={display} dict={dict} aiEnabled={aiEnabled} />
      <div className="flex items-stretch divide-x divide-slate-200 dark:divide-slate-700">
        {ttsSupported() && (
          <button type="button" onClick={() => speak(display)} className={item}>
            🔊 Speak
          </button>
        )}
        {aiEnabled && (
          <button type="button" onClick={onTranslate} className={item}>
            🌐 Translate
          </button>
        )}
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
      </div>
    </div>
  );
}

function WordPanel({
  display,
  context,
  dict,
  onClose,
}: {
  display: string;
  context?: string;
  dict: DictEntry | null;
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
  // Save under the base form (e.g. "trifft" → "treffen"). The offline dictionary
  // gives us the lemma instantly, before the AI reply lands.
  const headword = data?.lemma?.trim() || dict?.lemma || display;
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
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-base font-semibold">
            {headword}
            {inflected && (
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                from “{display}”
              </span>
            )}
          </span>
          <SpeakButton text={headword} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          ✕
        </button>
      </div>
      {loading && (
        <div className="py-2">
          {dict?.gloss && (
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {dict.gloss}
            </p>
          )}
          <p className="text-xs text-slate-400">Translating…</p>
        </div>
      )}
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
              <div className="flex items-start justify-between gap-1">
                <p className="text-slate-800 dark:text-slate-100">{ex.de}</p>
                <SpeakButton text={ex.de} className="-mr-1 -mt-1" />
              </div>
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
