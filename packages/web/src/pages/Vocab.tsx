import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SaveVocabBody, VocabEntry, VocabGroup } from "@mdb/shared";
import { SearchBox } from "../components/SearchBox";
import { SpeakButton } from "../components/SpeakButton";
import { api, formsFromLookup } from "../lib/api";
import { formChips } from "../lib/forms";
import { timeAgo } from "../lib/time";
import { useVocab } from "../lib/vocab";
import { CheckIcon, CrossIcon, PlusIcon, SparklesIcon, VocabIcon } from "../components/icons";
import { btn } from "../components/ui";

export function VocabPage() {
  const {
    entries,
    groups,
    reload,
    save,
    remove,
    createGroup,
    deleteGroup,
    setWordGroup,
    resetStudy,
    enabled,
    dictAvailable,
  } = useVocab();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flashcards study the selected group (or all) — independent of the search box.
  const poolCount = useMemo(
    () => entries.filter((e) => group == null || e.groups.includes(group)).length,
    [entries, group],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (group != null && !e.groups.includes(group)) return false;
      if (
        needle &&
        !e.display.toLowerCase().includes(needle) &&
        !e.translation.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [entries, q, group]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">Vocab</h1>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className={`${btn.primary} ${btn.sm} shrink-0`}
        >
          {!adding && <PlusIcon className="h-4 w-4" />}
          {adding ? "Close" : "Add word"}
        </button>
      </div>
      <p className="mb-4 text-sm text-ink-muted">
        Words you saved by tapping them in content, or added by hand.
      </p>

      {adding && (
        <AddWordForm
          enabled={enabled}
          dictAvailable={dictAvailable}
          onAdd={async (body) => {
            await save(body);
            setAdding(false);
          }}
        />
      )}

      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search words…" />
      </div>

      <GroupBar
        groups={groups}
        selected={group}
        onSelect={setGroup}
        onCreate={createGroup}
        onDelete={async (id) => {
          if (group === id) setGroup(null);
          await deleteGroup(id);
        }}
      />

      {poolCount > 0 && (
        <Link
          to={`/vocab/study?group=${group ?? "all"}`}
          className={`${btn.primary} mt-3 justify-center`}
        >
          <VocabIcon className="h-4 w-4" />
          Study flashcards
          <span className="opacity-80">
            {group == null ? `all ${poolCount}` : `${poolCount}`} card
            {poolCount === 1 ? "" : "s"}
          </span>
        </Link>
      )}

      {filtered.length === 0 ? (
        <p className="mt-4 rounded-card border border-dashed border-line-control p-6 text-center text-sm text-ink-muted ">
          {entries.length === 0
            ? "No words yet. Tap a word in a cheat sheet, exercise or story and choose Add to vocab, or use Add word above."
            : "No words match."}
        </p>
      ) : (
        <div className="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-card border border-line ">
          {filtered.map((e) => (
            <VocabRow
              key={e.word}
              entry={e}
              groups={groups}
              open={open === e.word}
              onToggle={() => setOpen(open === e.word ? null : e.word)}
              onRefresh={save}
              onRemove={remove}
              onCreateGroup={createGroup}
              onToggleGroup={setWordGroup}
              onResetStudy={resetStudy}
              canRefresh={enabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddWordForm({
  enabled,
  dictAvailable,
  onAdd,
}: {
  enabled: boolean;
  dictAvailable: boolean;
  onAdd: (body: SaveVocabBody) => Promise<void>;
}) {
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cached from a Generate action so Add doesn't re-query.
  const [gen, setGen] = useState<{
    examples: { de: string; en: string }[];
    lemma?: string;
    forms?: ReturnType<typeof formsFromLookup>;
  } | null>(null);

  const canGenerate = enabled || dictAvailable;

  /** Fill the translation from the AI (preferred) or the offline dictionary. */
  async function generate() {
    const w = word.trim();
    if (!w || genBusy) return;
    setGenBusy(true);
    setError(null);
    try {
      if (enabled) {
        const d = await api.translateWord(w, { count: 2 });
        setDefinition(d.translation);
        setGen({
          examples: d.examples,
          lemma: d.lemma?.trim(),
          forms: formsFromLookup(d),
        });
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenBusy(false);
    }
  }

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
      // User typed their own translation — enrich with examples + base form.
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
      await onAdd(body);
      setWord("");
      setDefinition("");
      setGen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-4 space-y-2 rounded-card border border-line bg-surface p-3 "
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={word}
          onChange={(e) => {
            setWord(e.target.value);
            setGen(null); // a new word invalidates a prior generation
          }}
          placeholder="Word (German)"
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
          className="input sm:w-1/3"
        />
        <div className="flex flex-1 items-stretch gap-2">
          <input
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            placeholder="Translation (optional)"
            className="input flex-1"
          />
          {canGenerate && (
            <button
              type="button"
              onClick={generate}
              disabled={!word.trim() || genBusy || busy}
              title={
                enabled
                  ? "Generate the translation with AI"
                  : "Fill from the built-in dictionary"
              }
              className="shrink-0 whitespace-nowrap rounded-control border border-line-control px-3 text-sm font-medium hover:border-line-strong disabled:opacity-50 "
            >
              {!genBusy && <SparklesIcon className="h-4 w-4" />}
              {genBusy ? "…" : "Generate"}
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={busy || genBusy || !word.trim()}
          className={`${btn.primary} shrink-0`}
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-xs text-ink-subtle">
        {enabled
          ? "Leave the translation blank and Add fills it (with examples) using AI — or tap Generate first."
          : dictAvailable
            ? "Leave the translation blank to fill it from the built-in dictionary."
            : "Enter a translation (AI tutor not configured)."}
      </p>
    </form>
  );
}

function GroupBar({
  groups,
  selected,
  onSelect,
  onCreate,
  onDelete,
}: {
  groups: VocabGroup[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  onCreate: (name: string) => Promise<VocabGroup>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium ${
      active
        ? "border-transparent bg-brand-soft text-brand-ink"
        : "border-line-control text-ink-muted hover:border-line-strong"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={chip(selected === null)} onClick={() => onSelect(null)}>
        All
      </button>
      {groups.map((g) => (
        <span key={g.id} className="inline-flex items-center">
          <button
            type="button"
            className={chip(selected === g.id)}
            onClick={() => onSelect(selected === g.id ? null : g.id)}
          >
            {g.name} <span className="opacity-60">{g.count}</span>
          </button>
          {selected === g.id && (
            <button
              type="button"
              onClick={() => void onDelete(g.id)}
              title="Delete group"
              className="ml-1 text-xs text-ink-subtle hover:text-danger"
            >
              <CrossIcon className="h-4 w-4" />
            </button>
          )}
        </span>
      ))}
      {creating ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (name.trim()) await onCreate(name.trim());
            setName("");
            setCreating(false);
          }}
          className="inline-flex items-center gap-1"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name.trim() && setCreating(false)}
            placeholder="Group name"
            className="w-32 rounded-full border border-line-control bg-transparent px-3 py-1 text-xs outline-none focus:border-focus "
          />
          <button type="submit" className="text-xs font-medium text-accent">
            Add
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-control px-3 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New group
        </button>
      )}
    </div>
  );
}

function VocabRow({
  entry,
  groups,
  open,
  onToggle,
  onRefresh,
  onRemove,
  onCreateGroup,
  onToggleGroup,
  onResetStudy,
  canRefresh,
}: {
  entry: VocabEntry;
  groups: VocabGroup[];
  open: boolean;
  onToggle: () => void;
  onRefresh: (b: SaveVocabBody) => Promise<VocabEntry>;
  onRemove: (word: string) => Promise<void>;
  onCreateGroup: (name: string) => Promise<VocabGroup>;
  onToggleGroup: (word: string, id: number, member: boolean) => Promise<void>;
  onResetStudy: (word: string) => Promise<void>;
  canRefresh: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const d = await api.translateWord(entry.display, { count: 2 });
      await onRefresh({
        word: entry.word,
        display: entry.display,
        translation: d.translation,
        examples: d.examples,
        forms: formsFromLookup(d),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const memberChips = groups.filter((g) => entry.groups.includes(g.id));

  return (
    <div className="bg-surface ">
      <div className="flex items-center pr-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-surface-sunken "
        >
          <span className="w-1/3 shrink-0 font-medium">{entry.display}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
            {entry.translation}
          </span>
          {memberChips.length > 0 && (
            <span className="hidden shrink-0 gap-1 sm:flex">
              {memberChips.slice(0, 2).map((g) => (
                <span
                  key={g.id}
                  className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] text-ink-muted "
                >
                  {g.name}
                </span>
              ))}
            </span>
          )}
          <MasteryDot entry={entry} />
          <span className="shrink-0 text-xs text-ink-subtle">{timeAgo(entry.createdAt)}</span>
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className={`shrink-0 text-ink-subtle transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <SpeakButton text={entry.display} className="ml-1" />
      </div>

      {open && (
        <div className="border-t border-line px-4 py-3 font-content ">
          <p className="text-sm text-ink ">{entry.translation}</p>
          <FormsLine forms={entry.forms} />
          <div className="mt-2 space-y-2">
            {entry.examples.map((ex, i) => (
              <div key={i} className="rounded-control bg-surface-sunken p-2 text-sm ">
                <div className="flex items-start justify-between gap-1">
                  <p className="text-ink ">{ex.de}</p>
                  <SpeakButton text={ex.de} className="-mr-1 -mt-1" />
                </div>
                <p className="text-ink-muted">{ex.en}</p>
              </div>
            ))}
            {entry.examples.length === 0 && (
              <p className="text-sm text-ink-subtle">No examples yet.</p>
            )}
          </div>

          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-ink-subtle">Groups</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {groups.map((g) => {
                const member = entry.groups.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => void onToggleGroup(entry.word, g.id, !member)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      member
                        ? "border-transparent bg-brand-soft text-brand-ink"
                        : "border-line-control text-ink-muted hover:border-line-strong"
                    }`}
                  >
                    {member && <CheckIcon className="mr-0.5 inline h-3 w-3" />}
                    {g.name}
                  </button>
                );
              })}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = newGroup.trim();
                  if (!name) return;
                  const g = await onCreateGroup(name);
                  await onToggleGroup(entry.word, g.id, true);
                  setNewGroup("");
                }}
                className="inline-flex items-center gap-1"
              >
                <input
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  placeholder="New group"
                  className="w-28 rounded-full border border-dashed border-line-control bg-transparent px-2.5 py-1 text-xs outline-none focus:border-focus "
                />
                {newGroup.trim() && (
                  <button type="submit" className="text-xs font-medium text-accent">
                    Add
                  </button>
                )}
              </form>
            </div>
          </div>

          {entry.stats && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
              <span className="font-medium text-ink-subtle">Flashcards:</span>
              <span className="text-success">{entry.stats.known} known</span>
              <span>·</span>
              <span className="text-danger">{entry.stats.missed} missed</span>
              {entry.stats.lastStudiedAt && (
                <span className="text-ink-subtle">
                  · last {timeAgo(entry.stats.lastStudiedAt)}
                </span>
              )}
              <button
                type="button"
                onClick={() => void onResetStudy(entry.word)}
                className="text-ink-subtle underline decoration-dotted hover:text-ink "
              >
                reset
              </button>
            </div>
          )}

          {error && (
            <p className="mt-2 rounded-control border border-transparent bg-danger-soft px-2 py-1.5 text-xs text-danger ">
              {error}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={busy || !canRefresh}
              title={canRefresh ? "" : "AI tutor not configured"}
              className={`${btn.secondary} ${btn.sm}`}
            >
              {busy ? "Regenerating…" : "↻ Regenerate"}
            </button>
            <button
              type="button"
              onClick={() => void onRemove(entry.word)}
              className="rounded-control border border-line-control px-3 py-1.5 text-sm font-medium text-danger hover:border-danger "
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Grammatical forms for a word: Perfekt/Partizip II (verbs), article + plural
 *  (nouns). */
function FormsLine({ forms }: { forms: VocabEntry["forms"] }) {
  const chips = formChips(forms);
  if (chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {chips.map(([label, val]) => (
        <span
          key={label}
          className="rounded-md bg-surface-sunken px-2 py-0.5 text-xs "
        >
          <span className="text-ink-subtle">{label}:</span>{" "}
          <span className="font-medium">{val}</span>
        </span>
      ))}
    </div>
  );
}

/** Small dot summarising a word's flashcard history: green if the last grade
 *  was "known", amber if "missed". Nothing when never studied. */
function MasteryDot({ entry }: { entry: VocabEntry }) {
  const s = entry.stats;
  if (!s || s.lastResult == null) return null;
  const known = s.lastResult;
  return (
    <span
      title={`Flashcards: ${s.known} known · ${s.missed} missed`}
      className={`h-2 w-2 shrink-0 rounded-full ${
        known ? "bg-success" : "bg-warning"
      }`}
      aria-hidden
    />
  );
}
