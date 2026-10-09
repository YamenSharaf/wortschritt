import { useEffect, useMemo, useState } from "react";
import type { DictEntry, SaveVocabBody, VocabEntry, VocabGroup, WordDetails, WordLookup } from "@mdb/shared";
import { formsFromLookup } from "../api";
import { useApi } from "./context";

/** How saved words are keyed: trimmed and lower-cased. */
export const vocabKey = (w: string) => w.trim().toLowerCase();

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The learner's saved words and groups, and every change to them. Each change
 * goes to the server first, then updates the local list (no refetch). Meant to
 * be held once, near the top of the app, and shared from there.
 */
export function useVocabState() {
  const api = useApi();
  const [enabled, setEnabled] = useState(false);
  const [dictAvailable, setDictAvailable] = useState(false);
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [groups, setGroups] = useState<VocabGroup[]>([]);

  const reload = () => {
    api.vocab().then(setEntries).catch(() => {});
    api.vocabGroups().then(setGroups).catch(() => {});
  };

  useEffect(() => {
    api.assistantStatus().then((s) => setEnabled(s.enabled)).catch(() => {});
    api.dictStatus().then((s) => setDictAvailable(s.available)).catch(() => {});
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const words = useMemo(() => new Set(entries.map((e) => e.word)), [entries]);

  async function save(body: SaveVocabBody) {
    const entry = await api.vocabSave(body);
    setEntries((prev) => [entry, ...prev.filter((e) => e.word !== entry.word)].sort((a, b) => b.createdAt - a.createdAt));
    return entry;
  }

  return {
    /** Whether the AI tutor is configured (the fuller word lookup needs it). */
    enabled,
    /** Whether the bundled offline dictionary is loaded (instant gloss on tap). */
    dictAvailable,
    /** Either source lets a tap open the word menu. */
    canTap: enabled || dictAvailable,
    entries,
    groups,
    /** Lowercased keys currently saved. */
    words,
    reload,
    save,
    /** Look the word up again with the AI and keep the new translation and examples. */
    async refresh(entry: VocabEntry) {
      const d = await api.translateWord(entry.display, { count: 2 });
      return save({
        word: entry.word,
        display: entry.display,
        translation: d.translation,
        examples: d.examples,
        forms: formsFromLookup(d),
      });
    },
    async remove(word: string) {
      await api.vocabRemove(word);
      setEntries((prev) => prev.filter((e) => e.word !== vocabKey(word)));
      api.vocabGroups().then(setGroups).catch(() => {});
    },
    async createGroup(name: string) {
      const g = await api.vocabGroupCreate(name);
      setGroups((prev) => [...prev, g].sort((a, b) => a.name.localeCompare(b.name)));
      return g;
    },
    async deleteGroup(id: number) {
      await api.vocabGroupDelete(id);
      setGroups((prev) => prev.filter((g) => g.id !== id));
      setEntries((prev) => prev.map((e) => ({ ...e, groups: e.groups.filter((g) => g !== id) })));
    },
    async setWordGroup(word: string, id: number, member: boolean) {
      if (member) await api.vocabGroupAddWord(id, word);
      else await api.vocabGroupRemoveWord(id, word);
      const w = vocabKey(word);
      setEntries((prev) =>
        prev.map((e) =>
          e.word !== w ? e : { ...e, groups: member ? [...new Set([...e.groups, id])] : e.groups.filter((g) => g !== id) },
        ),
      );
      setGroups((prev) => prev.map((g) => (g.id !== id ? g : { ...g, count: g.count + (member ? 1 : -1) })));
    },
    /** Record a flashcard grade; updates the word's kept score. */
    async recordStudy(word: string, known: boolean) {
      const w = vocabKey(word);
      const stats = await api.studyVocab(w, known);
      setEntries((prev) => prev.map((e) => (e.word === w ? { ...e, stats } : e)));
    },
    /** Clear a word's flashcard score. */
    async resetStudy(word: string) {
      const w = vocabKey(word);
      await api.resetVocabStudy(w);
      setEntries((prev) => prev.map((e) => (e.word === w ? { ...e, stats: null } : e)));
    },
  };
}

export type VocabState = ReturnType<typeof useVocabState>;

/** The words in a group (null: all), optionally matching a search in either language. */
export function filterVocab(entries: VocabEntry[], { group, query = "" }: { group: number | null; query?: string }) {
  const needle = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (group != null && !e.groups.includes(group)) return false;
    return !needle || e.display.toLowerCase().includes(needle) || e.translation.toLowerCase().includes(needle);
  });
}

/**
 * A tapped word's instant gloss (offline dictionary) and its Wiktionary
 * senses (slower). undefined = still looking; null = none.
 */
export function useWordLookup(word: string) {
  const api = useApi();
  const [dict, setDict] = useState<DictEntry | null | undefined>(undefined);
  const [details, setDetails] = useState<WordDetails | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setDict(undefined);
    setDetails(undefined);
    api
      .dict(word)
      .then((d) => alive && setDict(d))
      .catch(() => alive && setDict(null));
    api
      .wordDetails(word)
      .then((d) => alive && setDetails(d))
      .catch(() => alive && setDetails(null));
    return () => {
      alive = false;
    };
  }, [api, word]);
  return { dict, details };
}

/**
 * Translating a tapped word with the AI and saving it: under its base form
 * ("trifft" → "treffen"), optionally into groups. A word saved already in the
 * tapped form isn't looked up again.
 */
export function useWordTranslation({
  display,
  context,
  dict,
  vocab,
}: {
  display: string;
  context?: string;
  dict: DictEntry | null;
  vocab: VocabState;
}) {
  const api = useApi();
  const [fetched, setFetched] = useState<WordLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preSaved = vocab.entries.find((e) => e.word === vocabKey(display));

  function load() {
    setLoading(true);
    setError(null);
    api
      .translateWord(display, { context, count: 2 })
      .then(setFetched)
      .catch((e) => setError(msgOf(e)))
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
  // The offline dictionary gives the base form at once, before the AI answers.
  const headword = data?.lemma?.trim() || dict?.lemma || display;
  const savedEntry = vocab.entries.find((e) => e.word === vocabKey(headword));

  async function ensureSaved() {
    if (savedEntry || !data) return;
    await vocab.save({
      word: headword,
      display: headword,
      translation: data.translation,
      examples: data.examples,
      forms: fetched ? formsFromLookup(fetched) : undefined,
    });
  }
  async function setGroup(id: number, member: boolean) {
    await ensureSaved();
    await vocab.setWordGroup(headword, id, member);
  }

  return {
    /** The AI's answer, or the saved entry's. */
    data,
    /** The full AI lookup (with grammatical forms), when one was made. */
    fetched,
    loading,
    error,
    retry: load,
    headword,
    /** The headword differs from the tapped form. */
    inflected: headword.toLowerCase() !== display.toLowerCase(),
    savedEntry,
    saving,
    async add() {
      setSaving(true);
      try {
        await ensureSaved();
      } finally {
        setSaving(false);
      }
    },
    setGroup,
    /** Create a group and put the word in it. */
    async addToNewGroup(name: string) {
      const g = await vocab.createGroup(name.trim());
      await setGroup(g.id, true);
    },
  };
}

/**
 * Adding a word by hand. The translation can be typed, generated first, or
 * left blank to be filled on adding — by the AI (with examples and the base
 * form) when there is one, else the offline dictionary.
 */
export function useAddWord({ enabled, dictAvailable }: { enabled: boolean; dictAvailable: boolean }) {
  const api = useApi();
  const [word, setWordValue] = useState("");
  const [definition, setDefinition] = useState("");
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cached from a Generate action so adding doesn't ask again.
  const [gen, setGen] = useState<{
    examples: { de: string; en: string }[];
    lemma?: string;
    forms?: ReturnType<typeof formsFromLookup>;
  } | null>(null);

  /** Resolve the final entry, generating a translation if left blank. */
  async function resolve(w: string): Promise<SaveVocabBody | null> {
    let translation = definition.trim();
    let examples = gen?.examples ?? [];
    let headword = gen?.lemma || w;
    let forms = gen?.forms;

    if (!translation) {
      if (enabled) {
        const d = await api.translateWord(w, { count: 2 });
        translation = d.translation;
        examples = d.examples;
        headword = d.lemma?.trim() || w;
        forms = formsFromLookup(d);
      } else if (dictAvailable) {
        const d = await api.dict(w);
        if (d?.gloss) {
          translation = d.gloss;
          headword = d.lemma || w;
        }
      }
    } else if (enabled && !gen) {
      // A typed translation: still fetch examples and the base form.
      try {
        const d = await api.translateWord(w, { meaning: translation, count: 2 });
        examples = d.examples;
        headword = d.lemma?.trim() || w;
        forms = formsFromLookup(d);
      } catch {
        /* keep the typed translation without examples */
      }
    }

    if (!translation) return null;
    return { word: headword, display: headword, translation, examples, forms };
  }

  return {
    word,
    /** A new word drops a translation generated for the last one. */
    setWord(w: string) {
      setWordValue(w);
      setGen(null);
    },
    definition,
    setDefinition,
    busy,
    genBusy,
    error,
    canGenerate: enabled || dictAvailable,
    /** Fill the translation from the AI (preferred) or the offline dictionary. */
    async generate() {
      const w = word.trim();
      if (!w || genBusy) return;
      setGenBusy(true);
      setError(null);
      try {
        if (enabled) {
          const d = await api.translateWord(w, { count: 2 });
          setDefinition(d.translation);
          setGen({ examples: d.examples, lemma: d.lemma?.trim(), forms: formsFromLookup(d) });
        } else {
          const d = await api.dict(w);
          if (d?.gloss) {
            setDefinition(d.gloss);
            setGen({ examples: [], lemma: d.lemma });
          } else {
            setError("No offline definition found — type one.");
          }
        }
      } catch (e) {
        setError(msgOf(e));
      } finally {
        setGenBusy(false);
      }
    },
    /** Resolve the entry and hand it to `save`; clears the form when it worked. */
    async add(save: (body: SaveVocabBody) => Promise<unknown>) {
      const w = word.trim();
      if (!w || busy || genBusy) return;
      setBusy(true);
      setError(null);
      try {
        const body = await resolve(w);
        if (!body) {
          setError("Add a translation, or generate one.");
          return;
        }
        await save(body);
        setWordValue("");
        setDefinition("");
        setGen(null);
      } catch (e) {
        setError(msgOf(e));
      } finally {
        setBusy(false);
      }
    },
  };
}

/** Shuffle a copy of `list` (Fisher–Yates). */
export function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/**
 * A flashcard session over `pool`: shuffled, flip, grade (kept on the server
 * by `recordStudy`), then a summary with the missed ones to review. Starts on
 * its own once the pool has words.
 */
export function useFlashcards(pool: VocabEntry[], recordStudy: (word: string, known: boolean) => Promise<void>) {
  const [queue, setQueue] = useState<VocabEntry[]>([]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<"loading" | "playing" | "done">("loading");

  function start(list: VocabEntry[]) {
    setQueue(shuffle(list));
    setI(0);
    setFlipped(false);
    setResults({});
    setPhase("playing");
  }

  // Kick off once the vocab has loaded (it arrives asynchronously).
  useEffect(() => {
    if (phase === "loading" && pool.length > 0) start(pool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length]);

  const card = queue[i];
  const known = queue.filter((c) => results[c.word]).length;
  const missed = queue.filter((c) => results[c.word] === false);

  return {
    phase,
    queue,
    index: i,
    card,
    flipped,
    setFlipped,
    flip: () => setFlipped((f) => !f),
    start,
    /** Grade the current card and move on (or finish). */
    grade(isKnown: boolean) {
      if (!card) return;
      setResults((r) => ({ ...r, [card.word]: isKnown }));
      void recordStudy(card.word, isKnown).catch(() => {});
      if (i + 1 < queue.length) {
        setI(i + 1);
        setFlipped(false);
      } else {
        setPhase("done");
      }
    },
    /** This session so far. */
    knownCount: known,
    missed,
    missedCount: missed.length,
    percent: queue.length ? Math.round((known / queue.length) * 100) : 0,
  };
}
