import { useEffect, useMemo, useState } from "react";
import type { VocabEntry, VocabGroup } from "@mdb/shared";
import { SearchBox } from "../components/SearchBox";
import { SpeakButton } from "../components/SpeakButton";
import { api } from "../lib/api";
import { timeAgo } from "../lib/time";
import { useVocab } from "../lib/vocab";

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
    enabled,
  } = useVocab();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <h1 className="text-2xl font-bold">Vocab</h1>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
        >
          {adding ? "Close" : "＋ Add word"}
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Words you saved by tapping them in content, or added by hand.
      </p>

      {adding && (
        <AddWordForm
          enabled={enabled}
          onAdd={async (word, definition) => {
            let examples: { de: string; en: string }[] = [];
            if (enabled) {
              try {
                const d = await api.translateWord(word, {
                  meaning: definition,
                  count: 2,
                });
                examples = d.examples;
              } catch {
                /* save without examples; user can refresh later */
              }
            }
            await save({ word, display: word, translation: definition, examples });
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

      {filtered.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          {entries.length === 0
            ? "No words yet. Tap a word in a cheat sheet or exercise → 🌐 Translate → ＋ Add, or use ＋ Add word above."
            : "No words match."}
        </p>
      ) : (
        <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
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
  onAdd,
}: {
  enabled: boolean;
  onAdd: (word: string, definition: string) => Promise<void>;
}) {
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!word.trim() || !definition.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(word.trim(), definition.trim());
      setWord("");
      setDefinition("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-4 space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="Word (German)"
          autoCapitalize="none"
          autoCorrect="off"
          className="input sm:w-1/3"
        />
        <input
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
          placeholder="Definition / translation"
          className="input flex-1"
        />
        <button
          type="submit"
          disabled={busy || !word.trim() || !definition.trim()}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      <p className="text-xs text-slate-400">
        {enabled
          ? "Example sentences are generated automatically from your definition."
          : "Saved without examples (AI tutor not configured)."}
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
        ? "border-accent bg-accent text-accent-foreground"
        : "border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
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
              className="ml-1 text-xs text-slate-400 hover:text-red-600"
            >
              ✕
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
            className="w-32 rounded-full border border-slate-300 bg-transparent px-3 py-1 text-xs outline-none focus:border-accent dark:border-slate-700"
          />
          <button type="submit" className="text-xs font-medium text-accent">
            Add
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-slate-400 dark:border-slate-700"
        >
          ＋ New group
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
  canRefresh,
}: {
  entry: VocabEntry;
  groups: VocabGroup[];
  open: boolean;
  onToggle: () => void;
  onRefresh: (b: {
    word: string;
    display: string;
    translation: string;
    examples: { de: string; en: string }[];
  }) => Promise<VocabEntry>;
  onRemove: (word: string) => Promise<void>;
  onCreateGroup: (name: string) => Promise<VocabGroup>;
  onToggleGroup: (word: string, id: number, member: boolean) => Promise<void>;
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
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const memberChips = groups.filter((g) => entry.groups.includes(g.id));

  return (
    <div className="bg-white dark:bg-slate-900">
      <div className="flex items-center pr-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
        >
          <span className="w-1/3 shrink-0 font-medium">{entry.display}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-slate-500">
            {entry.translation}
          </span>
          {memberChips.length > 0 && (
            <span className="hidden shrink-0 gap-1 sm:flex">
              {memberChips.slice(0, 2).map((g) => (
                <span
                  key={g.id}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800"
                >
                  {g.name}
                </span>
              ))}
            </span>
          )}
          <span className="shrink-0 text-xs text-slate-400">{timeAgo(entry.createdAt)}</span>
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
        <SpeakButton text={entry.display} className="ml-1" />
      </div>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 font-content dark:border-slate-800">
          <p className="text-sm text-slate-700 dark:text-slate-200">{entry.translation}</p>
          <div className="mt-2 space-y-2">
            {entry.examples.map((ex, i) => (
              <div key={i} className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800">
                <div className="flex items-start justify-between gap-1">
                  <p className="text-slate-800 dark:text-slate-100">{ex.de}</p>
                  <SpeakButton text={ex.de} className="-mr-1 -mt-1" />
                </div>
                <p className="text-slate-500">{ex.en}</p>
              </div>
            ))}
            {entry.examples.length === 0 && (
              <p className="text-sm text-slate-400">No examples yet.</p>
            )}
          </div>

          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-slate-400">Groups</p>
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
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-700"
                    }`}
                  >
                    {member ? "✓ " : ""}
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
                  className="w-28 rounded-full border border-dashed border-slate-300 bg-transparent px-2.5 py-1 text-xs outline-none focus:border-accent dark:border-slate-700"
                />
                {newGroup.trim() && (
                  <button type="submit" className="text-xs font-medium text-accent">
                    Add
                  </button>
                )}
              </form>
            </div>
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
