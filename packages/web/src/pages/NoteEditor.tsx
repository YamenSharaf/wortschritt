import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "markdown-to-jsx";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Cheatsheet } from "@mdb/shared";
import { TapToTranslate } from "../components/TapToTranslate";
import { api } from "../lib/api";
import { useAsync } from "@mdb/client/react";
import { ChevronLeftIcon, SheetsIcon, SparklesIcon } from "../components/icons";
import { btn } from "../components/ui";

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

// Reading size for the note body, remembered per device.
const FONT_KEY = "mdb-note-fontsize";
const MIN_FONT = 12;
const MAX_FONT = 26;
const DEFAULT_FONT = 16;
function getNoteFontSize(): number {
  try {
    const n = Number(localStorage.getItem(FONT_KEY));
    return n >= MIN_FONT && n <= MAX_FONT ? n : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}
function storeNoteFontSize(px: number): void {
  try {
    localStorage.setItem(FONT_KEY, String(px));
  } catch {
    /* ignore */
  }
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
  const [fontSize, setFontSize] = useState(getNoteFontSize);

  function changeFont(delta: number) {
    setFontSize((s) => {
      const next = Math.min(MAX_FONT, Math.max(MIN_FONT, s + delta));
      storeNoteFontSize(next);
      return next;
    });
  }

  const ready = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed the editor once the note arrives.
  useEffect(() => {
    if (loaded.status === "ready" && loaded.data && !ready.current) {
      setTitle(loaded.data.title);
      setCategory(loaded.data.category);
      setBody(loaded.data.body);
      // An existing note (already has content) opens in Preview; a blank new
      // note opens in Write so you can start typing.
      setMode(loaded.data.body.trim() ? "preview" : "write");
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
    return <p className="text-ink-muted">Loading…</p>;
  }
  if (loaded.status === "error" || (loaded.status === "ready" && !loaded.data)) {
    return (
      <div>
        <Link to="/notes" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
          <ChevronLeftIcon className="h-4 w-4" />
          Notes
        </Link>
        <p className="mt-4 text-danger">Note not found.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Link to="/notes" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
          <ChevronLeftIcon className="h-4 w-4" />
          Notes
        </Link>
        <SaveIndicator state={saveState} />
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="mt-3 w-full border-0 bg-transparent p-0 text-2xl font-bold outline-none placeholder:text-ink-subtle "
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category (optional)"
          list="note-categories"
          className="rounded-control border border-line-control bg-transparent px-3 py-1 text-sm outline-none focus:border-focus "
        />
        <datalist id="note-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1 rounded-card border border-line p-1 ">
          <TabBtn active={mode === "write"} onClick={() => setMode("write")}>
            Write
          </TabBtn>
          <TabBtn active={mode === "preview"} onClick={() => setMode("preview")}>
            Preview
          </TabBtn>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-card border border-line p-1 ">
          <FontBtn
            label="Smaller text"
            disabled={fontSize <= MIN_FONT}
            onClick={() => changeFont(-1)}
          >
            <span className="text-xs">A</span>
            <span aria-hidden>−</span>
          </FontBtn>
          <FontBtn
            label="Larger text"
            disabled={fontSize >= MAX_FONT}
            onClick={() => changeFont(1)}
          >
            <span className="text-base leading-none">A</span>
            <span aria-hidden>+</span>
          </FontBtn>
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
              className="rounded-control border border-line-control px-3 py-1.5 text-sm hover:border-line-strong "
            >
              ↶ Undo cleanup
            </button>
          )}
          <button
            type="button"
            onClick={cleanUp}
            disabled={aiBusy || !body.trim()}
            className={`${btn.secondary} ${btn.sm}`}
          >
            {!aiBusy && <SparklesIcon className="h-4 w-4" />}
            {aiBusy ? "Cleaning…" : "Clean up"}
          </button>
          <button
            type="button"
            onClick={saveAsCheatsheet}
            disabled={savingSheet || !body.trim()}
            className={`${btn.secondary} ${btn.sm}`}
          >
            {!savingSheet && <SheetsIcon className="h-4 w-4" />}
            {savingSheet ? "Saving…" : "Save as cheat sheet"}
          </button>
        </div>
      </div>

      {aiError && (
        <p className="mt-2 rounded-control border border-transparent bg-danger-soft px-3 py-1.5 text-xs text-danger ">
          {aiError}
        </p>
      )}

      <div className="mt-3">
        {mode === "write" ? (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            style={{ fontSize }}
            placeholder={
              "Write your notes here. Markdown works:\n\n# Heading\n- point one\n- **bold** and `code`\n\n| der | die | das |\n| --- | --- | --- |"
            }
            className="min-h-[60vh] w-full resize-y rounded-card border border-line bg-surface p-4 font-note leading-relaxed outline-none focus:border-focus "
          />
        ) : (
          <div
            style={{ fontSize }}
            className="min-h-[60vh] rounded-card border border-line p-4 "
          >
            {body.trim() ? (
              <TapToTranslate className="md font-note leading-relaxed">
                <Markdown options={mdOptions}>{body}</Markdown>
              </TapToTranslate>
            ) : (
              <p className="italic text-ink-subtle">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={del}
          className="rounded-control border border-line-control px-3 py-1.5 text-sm font-medium text-danger hover:border-danger "
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
      className={`rounded-control px-3 py-1.5 text-sm font-medium ${
        active
          ? "bg-surface-raised text-ink shadow-card"
          : "text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function FontBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 items-center gap-0.5 rounded-control px-2 text-ink-muted hover:bg-surface-sunken disabled:opacity-40 "
    >
      {children}
    </button>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, { text: string; cls: string }> = {
    idle: { text: "", cls: "" },
    saving: { text: "Saving…", cls: "text-ink-subtle" },
    saved: { text: "Saved", cls: "text-success" },
    error: { text: "Save failed", cls: "text-danger" },
  };
  const { text, cls } = map[state];
  if (!text) return null;
  return <span className={`text-xs ${cls}`}>{text}</span>;
}
