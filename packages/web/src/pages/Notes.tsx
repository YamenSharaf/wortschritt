import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Note } from "@mdb/shared";
import { SearchBox } from "../components/SearchBox";
import { api } from "../lib/api";
import { timeAgo } from "../lib/time";
import { useAsync } from "../lib/useAsync";

/** A short, plain-text preview of a Markdown note body. */
function snippet(body: string): string {
  return body
    .replace(/[#>*_`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function NotesPage() {
  const notes = useAsync(() => api.notes(), []);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = notes.status === "ready" ? notes.data : [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const n of list) if (n.category.trim()) set.add(n.category.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [list]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((n) => {
      if (category != null && n.category.trim() !== category) return false;
      if (
        needle &&
        !n.title.toLowerCase().includes(needle) &&
        !n.category.toLowerCase().includes(needle) &&
        !n.body.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [list, q, category]);

  async function newNote() {
    if (creating) return;
    setCreating(true);
    try {
      const n = await api.createNote({ title: "Untitled" });
      navigate(`/notes/${n.id}`);
    } finally {
      setCreating(false);
    }
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium ${
      active
        ? "border-accent bg-accent text-accent-foreground"
        : "border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
    }`;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Notes</h1>
        <button
          type="button"
          onClick={newNote}
          disabled={creating}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {creating ? "…" : "＋ New note"}
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Jot down anything as you learn. Notes support Markdown and save
        automatically.
      </p>

      {list.length > 3 && (
        <div className="mb-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search notes…" />
        </div>
      )}

      {categories.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={chip(category === null)}
            onClick={() => setCategory(null)}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={chip(category === c)}
              onClick={() => setCategory(category === c ? null : c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {notes.status === "loading" && <p className="text-slate-500">Loading…</p>}
      {notes.status === "ready" && list.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No notes yet. Tap “＋ New note” to start writing.
        </p>
      )}
      {notes.status === "ready" && list.length > 0 && filtered.length === 0 && (
        <p className="text-slate-500">No notes match.</p>
      )}

      {filtered.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteCard({ note }: { note: Note }) {
  const preview = snippet(note.body);
  return (
    <Link
      to={`/notes/${note.id}`}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 font-medium">
          {note.title.trim() || "Untitled"}
        </div>
        <span className="shrink-0 text-xs text-slate-400">
          {timeAgo(note.updatedAt)}
        </span>
      </div>
      {note.category.trim() && (
        <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
          {note.category.trim()}
        </div>
      )}
      <p className="mt-2 line-clamp-3 text-sm text-slate-500">
        {preview || <span className="italic text-slate-400">Empty note</span>}
      </p>
    </Link>
  );
}
