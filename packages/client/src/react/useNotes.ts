import { useEffect, useRef, useState } from "react";
import { ATTACHMENT_MAX_BYTES, type Cheatsheet, type Note, type NoteAttachment } from "@mdb/shared";
import { timers, type TimerId } from "../timers";
import { useApi } from "./context";
import { useAsync } from "./useAsync";

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The categories used across notes, sorted. */
export function noteCategories(notes: Note[]): string[] {
  const set = new Set<string>();
  for (const n of notes) if (n.category.trim()) set.add(n.category.trim());
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Notes in a category (null: all) matching a search in the title, category or text. */
export function filterNotes(notes: Note[], { category, query = "" }: { category: string | null; query?: string }) {
  const needle = query.trim().toLowerCase();
  return notes.filter((n) => {
    if (category != null && n.category.trim() !== category) return false;
    return (
      !needle ||
      n.title.toLowerCase().includes(needle) ||
      n.category.toLowerCase().includes(needle) ||
      n.body.toLowerCase().includes(needle)
    );
  });
}

/** A short, plain-text preview of a Markdown note body. */
export function noteSnippet(body: string): string {
  return body
    .replace(/[#>*_`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Split a Markdown note into cheat-sheet sections on its headings. */
export function noteToCheatsheet(note: { id: string; title: string; category: string; body: string }): Cheatsheet {
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
    sections.push({ heading: note.title.trim() || "Notes", body: note.body.trim() || "—" });
  }
  return {
    id: `note-${note.id}`,
    title: note.title.trim() || "Untitled note",
    category: note.category.trim() || "notes",
    sections,
  };
}

export type NoteSaveState = "idle" | "saving" | "saved" | "error";

/**
 * Editing one note: it saves itself shortly after each change, can be cleaned
 * up by the AI (with undo), saved as a cheat sheet, or deleted. An existing
 * note opens in preview, a blank one for writing.
 */
export function useNoteEditor(id: string) {
  const api = useApi();
  const loaded = useAsync(() => api.note(id), [id]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [saveState, setSaveState] = useState<NoteSaveState>("idle");
  const [categories, setCategories] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoBody, setUndoBody] = useState<string | null>(null);
  const [savingSheet, setSavingSheet] = useState(false);
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [attaching, setAttaching] = useState(0);
  const ready = useRef(false);
  const saveTimer = useRef<TimerId | undefined>(undefined);
  /** The fields as last loaded or saved: only a difference is saved. */
  const saved = useRef("");

  // Seed the editor once the note arrives.
  useEffect(() => {
    if (loaded.status === "ready" && loaded.data && !ready.current) {
      setTitle(loaded.data.title);
      setCategory(loaded.data.category);
      setBody(loaded.data.body);
      setMode(loaded.data.body.trim() ? "preview" : "write");
      setAttachments(loaded.data.attachments ?? []);
      saved.current = JSON.stringify([loaded.data.title, loaded.data.category, loaded.data.body]);
      ready.current = true;
    }
  }, [loaded]);

  // Category suggestions from existing notes.
  useEffect(() => {
    api.notes().then((ns) => setCategories(noteCategories(ns))).catch(() => {});
  }, [api]);

  // Save shortly after a change (opening the note isn't one: saving would
  // move it to the top of the list).
  useEffect(() => {
    const fields = JSON.stringify([title, category, body]);
    if (!ready.current) return;
    if (fields === saved.current) {
      // Back to what's stored (the pending save was dropped by the cleanup).
      setSaveState((st) => (st === "saving" ? "saved" : st));
      return;
    }
    setSaveState("saving");
    timers.clearTimeout(saveTimer.current);
    saveTimer.current = timers.setTimeout(() => {
      api
        .saveNote(id, { title, category, body })
        .then(() => {
          saved.current = fields;
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 700);
    return () => timers.clearTimeout(saveTimer.current);
  }, [api, title, category, body, id]);

  // Leaving with a change not saved yet (the timer above is cleared): save it now.
  const latest = useRef({ title, category, body });
  latest.current = { title, category, body };
  useEffect(
    () => () => {
      const f = latest.current;
      if (ready.current && JSON.stringify([f.title, f.category, f.body]) !== saved.current) void api.saveNote(id, f).catch(() => {});
    },
    [api, id],
  );

  return {
    status: loaded.status === "ready" && !loaded.data ? ("missing" as const) : loaded.status,
    title,
    setTitle,
    category,
    setCategory,
    body,
    setBody,
    mode,
    setMode,
    saveState,
    /** Categories of the other notes, for suggestions. */
    categories,
    aiBusy,
    savingSheet,
    error,
    /** The body before the last AI clean-up (null: nothing to undo). */
    undoBody,
    /** Have the AI tidy the note's Markdown; shows the result in preview. */
    async cleanUp() {
      if (!body.trim() || aiBusy) return;
      setAiBusy(true);
      setError(null);
      try {
        const res = await api.cleanupNotes(body);
        setUndoBody(body);
        setBody(res.text);
        setMode("preview");
      } catch (e) {
        setError(msgOf(e));
      } finally {
        setAiBusy(false);
      }
    },
    undoCleanUp() {
      if (undoBody === null) return;
      setBody(undoBody);
      setUndoBody(null);
      setMode("write");
    },
    /** Import the note as a cheat sheet (sections at its headings); resolves with the sheet's id. */
    async saveAsCheatsheet(): Promise<string | null> {
      if (!body.trim() || savingSheet) return null;
      setSavingSheet(true);
      try {
        const sheet = noteToCheatsheet({ id, title, category, body });
        await api.import({ kind: "cheatsheet", data: sheet });
        return sheet.id;
      } catch (e) {
        setError(msgOf(e));
        return null;
      } finally {
        setSavingSheet(false);
      }
    },
    /** Files kept with the note, oldest first. */
    attachments,
    /** How many uploads are under way. */
    attaching,
    /** Upload files to keep with the note (needs the server; a failure shows in `error`). */
    async attach(files: Array<{ name: string; type: string; size: number; body: object }>) {
      setError(null);
      for (const f of files) {
        if (f.size > ATTACHMENT_MAX_BYTES) {
          setError(`"${f.name}" is larger than ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`);
          continue;
        }
        setAttaching((n) => n + 1);
        try {
          const a = await api.uploadAttachment(id, f);
          setAttachments((list) => [...list, a]);
        } catch (e) {
          setError(`Couldn't attach "${f.name}": ${msgOf(e)}`);
        } finally {
          setAttaching((n) => n - 1);
        }
      }
    },
    async removeAttachment(attachmentId: string) {
      setError(null);
      try {
        await api.removeAttachment(attachmentId);
        setAttachments((list) => list.filter((a) => a.id !== attachmentId));
      } catch (e) {
        setError(msgOf(e));
      }
    },
    /** Delete the note (ask first); a pending save is dropped so it can't recreate it. */
    async remove() {
      timers.clearTimeout(saveTimer.current);
      ready.current = false;
      await api.removeNote(id).catch(() => {});
    },
  };
}
