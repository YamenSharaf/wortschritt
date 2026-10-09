import Markdown from "markdown-to-jsx";
import { Link, useNavigate, useParams } from "react-router-dom";
import { NOTE_FONT_SIZE, preferences } from "@mdb/client";
import { useNoteEditor, usePreference, type NoteSaveState } from "@mdb/client/react";
import { TapToTranslate } from "../components/TapToTranslate";
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

const { min: MIN_FONT, max: MAX_FONT } = NOTE_FONT_SIZE;

export function NoteEditor() {
  const { id } = useParams();
  const note = useNoteEditor(id!);
  const { title, category, body, mode, saveState, categories, aiBusy, savingSheet, undoBody } = note;
  const aiError = note.error;
  const navigate = useNavigate();
  // Reading size for the note body, remembered per device.
  const [fontSize, setFontSize] = usePreference(preferences.noteFontSize);

  function changeFont(delta: number) {
    setFontSize((s) => Math.min(MAX_FONT, Math.max(MIN_FONT, s + delta)));
  }

  async function saveAsCheatsheet() {
    const sheetId = await note.saveAsCheatsheet();
    if (sheetId) navigate(`/cheatsheets/${sheetId}`);
  }

  async function del() {
    if (!confirm("Delete this note? This can't be undone.")) return;
    await note.remove();
    navigate("/notes");
  }

  if (note.status === "loading") {
    return <p className="text-ink-muted">Loading…</p>;
  }
  if (note.status === "error" || note.status === "missing") {
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
        onChange={(e) => note.setTitle(e.target.value)}
        placeholder="Title"
        className="mt-3 w-full border-0 bg-transparent p-0 text-2xl font-bold outline-none placeholder:text-ink-subtle "
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={category}
          onChange={(e) => note.setCategory(e.target.value)}
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
          <TabBtn active={mode === "write"} onClick={() => note.setMode("write")}>
            Write
          </TabBtn>
          <TabBtn active={mode === "preview"} onClick={() => note.setMode("preview")}>
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
              onClick={note.undoCleanUp}
              className="rounded-control border border-line-control px-3 py-1.5 text-sm hover:border-line-strong "
            >
              ↶ Undo cleanup
            </button>
          )}
          <button
            type="button"
            onClick={() => void note.cleanUp()}
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
            onChange={(e) => note.setBody(e.target.value)}
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

function SaveIndicator({ state }: { state: NoteSaveState }) {
  const map: Record<NoteSaveState, { text: string; cls: string }> = {
    idle: { text: "", cls: "" },
    saving: { text: "Saving…", cls: "text-ink-subtle" },
    saved: { text: "Saved", cls: "text-success" },
    error: { text: "Save failed", cls: "text-danger" },
  };
  const { text, cls } = map[state];
  if (!text) return null;
  return <span className={`text-xs ${cls}`}>{text}</span>;
}
