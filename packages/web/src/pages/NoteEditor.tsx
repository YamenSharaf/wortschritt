import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "markdown-to-jsx";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Cheatsheet } from "@mdb/shared";
import { TapToTranslate } from "../components/TapToTranslate";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

const mdOptions = {
  forceBlock: true,
  overrides: {
    table: {
      component: ({ children, ...props }: { children?: React.ReactNode }) => (
        <div className="overflow-x-auto">
          <table {...props}>{children}</table>
        </div>
      ),
    },
  },
};

/** Split a Markdown note into cheat-sheet sections on its headings. */
function noteToCheatsheet(note: {
  id: string;
  title: string;
  category: string;
  body: string;
}): Cheatsheet {
  const sections: { heading: string; body: string }[] = [];
  let heading = note.title.trim() || "Notes";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ heading: heading.trim() || "Notes", body });
    buf = [];
  };
  for (const line of note.body.split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) {
      flush();
      heading = (m[1] ?? "").trim() || "Section";
    } else {
      buf.push(line);
    }
  }
  flush();
  if (sections.length === 0) {
    sections.push({
      heading: note.title.trim() || "Notes",
      body: note.body.trim() || "—",
    });
  }
  return {
    id: `note-${note.id}`,
    title: note.title.trim() || "Untitled note",
    category: note.category.trim() || "notes",
    sections,
  };
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function NoteEditor() {
  const { id } = useParams();
  const loaded = useAsync(() => api.note(id!), [id]);
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [categories, setCategories] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [undoBody, setUndoBody] = useState<string | null>(null);
  const [savingSheet, setSavingSheet] = useState(false);

  const ready = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed the editor once the note arrives.
  useEffect(() => {
    if (loaded.status === "ready" && loaded.data && !ready.current) {
      setTitle(loaded.data.title);
      setCategory(loaded.data.category);
      setBody(loaded.data.body);
      ready.current = true;
    }
  }, [loaded.status]);

  // Category suggestions from existing notes.
  useEffect(() => {
    api
      .notes()
      .then((ns) => {
        const set = new Set<string>();
        for (const n of ns) if (n.category.trim()) set.add(n.category.trim());
        setCategories([...set].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
  }, []);

  // Debounced auto-save whenever a field changes (after the initial load).
  useEffect(() => {
    if (!ready.current || !id) return;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api
        .saveNote(id, { title, category, body })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [title, category, body, id]);

  async function cleanUp() {
    if (!body.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await api.cleanupNotes(body);
      setUndoBody(body);
      setBody(res.text);
      setMode("preview");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  async function saveAsCheatsheet() {
    if (!id || !body.trim() || savingSheet) return;
    setSavingSheet(true);
    try {
      const sheet = noteToCheatsheet({ id, title, category, body });
      await api.import({ kind: "cheatsheet", data: sheet });
      navigate(`/cheatsheets/${sheet.id}`);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSheet(false);
    }
  }

  async function del() {
    if (!id) return;
    if (!confirm("Delete this note? This can't be undone.")) return;
    // Cancel any pending save so it doesn't recreate the row.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    ready.current = false;
    await api.removeNote(id).catch(() => {});
    navigate("/notes");
  }

  if (loaded.status === "loading") {
    return <p className="text-slate-500">Loading…</p>;
  }
  if (loaded.status === "error" || (loaded.status === "ready" && !loaded.data)) {
    return (
      <div>
        <Link to="/notes" className="text-sm text-slate-500 hover:underline">
          ← Notes
        </Link>
        <p className="mt-4 text-red-600">Note not found.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Link to="/notes" className="text-sm text-slate-500 hover:underline">
          ← Notes
        </Link>
        <SaveIndicator state={saveState} />
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="mt-3 w-full border-0 bg-transparent p-0 text-2xl font-bold outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category (optional)"
          list="note-categories"
          className="rounded-lg border border-slate-300 bg-transparent px-3 py-1 text-sm outline-none focus:border-accent dark:border-slate-700"
        />
        <datalist id="note-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1 rounded-xl border border-slate-200 p-1 dark:border-slate-800">
          <TabBtn active={mode === "write"} onClick={() => setMode("write")}>
            Write
          </TabBtn>
          <TabBtn active={mode === "preview"} onClick={() => setMode("preview")}>
            Preview
          </TabBtn>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {undoBody !== null && (
            <button
              type="button"
              onClick={() => {
                setBody(undoBody);
                setUndoBody(null);
                setMode("write");
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-500 dark:border-slate-700"
            >
              ↶ Undo cleanup
            </button>
          )}
          <button
            type="button"
            onClick={cleanUp}
            disabled={aiBusy || !body.trim()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-500 disabled:opacity-50 dark:border-slate-700"
          >
            {aiBusy ? "Cleaning…" : "✨ Clean up"}
          </button>
          <button
            type="button"
            onClick={saveAsCheatsheet}
            disabled={savingSheet || !body.trim()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-500 disabled:opacity-50 dark:border-slate-700"
          >
            {savingSheet ? "Saving…" : "📄 Save as cheat sheet"}
          </button>
        </div>
      </div>

      {aiError && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {aiError}
        </p>
      )}

      <div className="mt-3">
        {mode === "write" ? (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              "Write your notes here. Markdown works:\n\n# Heading\n- point one\n- **bold** and `code`\n\n| der | die | das |\n| --- | --- | --- |"
            }
            className="min-h-[60vh] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 font-content text-sm leading-relaxed outline-none focus:border-accent dark:border-slate-800 dark:bg-slate-900"
          />
        ) : (
          <div className="min-h-[60vh] rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            {body.trim() ? (
              <TapToTranslate className="md font-content text-sm leading-relaxed">
                <Markdown options={mdOptions}>{body}</Markdown>
              </TapToTranslate>
            ) : (
              <p className="text-sm italic text-slate-400">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={del}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:border-red-400 dark:border-slate-700"
        >
          Delete note
        </button>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, { text: string; cls: string }> = {
    idle: { text: "", cls: "" },
    saving: { text: "Saving…", cls: "text-slate-400" },
    saved: { text: "Saved ✓", cls: "text-green-600" },
    error: { text: "Save failed", cls: "text-red-600" },
  };
  const { text, cls } = map[state];
  if (!text) return null;
  return <span className={`text-xs ${cls}`}>{text}</span>;
}
