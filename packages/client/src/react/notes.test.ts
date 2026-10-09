import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { Note } from "@mdb/shared";
import type { Api, StoryGenerationEvent } from "../api";
import { act, flush, renderHook } from "./testing";
import { filterNotes, noteCategories, noteToCheatsheet, useNoteEditor } from "./useNotes";
import { storyProgressText, useStoryGeneration } from "./useStoryGeneration";

const note = (id: string, patch: Partial<Note> = {}): Note =>
  ({ id, title: id, category: "", body: "", createdAt: 0, updatedAt: 0, ...patch }) as Note;

test("noteToCheatsheet: a section per heading, the title before the first", () => {
  const sheet = noteToCheatsheet({ id: "n1", title: "Kasus", category: "", body: "intro\n## Dativ\nmit dem\n# Akkusativ\nden" });
  assert.equal(sheet.id, "note-n1");
  assert.equal(sheet.category, "notes");
  assert.deepEqual(sheet.sections, [
    { heading: "Kasus", body: "intro" },
    { heading: "Dativ", body: "mit dem" },
    { heading: "Akkusativ", body: "den" },
  ]);
  assert.deepEqual(noteToCheatsheet({ id: "e", title: "", category: "", body: "" }).sections, [{ heading: "Notes", body: "—" }]);
});

test("filterNotes and noteCategories", () => {
  const notes = [note("a", { category: " Grammar ", body: "Dativ" }), note("b", { category: "Words" }), note("c")];
  assert.deepEqual(noteCategories(notes), ["Grammar", "Words"]);
  assert.deepEqual(filterNotes(notes, { category: "Grammar" }).map((n) => n.id), ["a"]);
  assert.deepEqual(filterNotes(notes, { category: null, query: "dativ" }).map((n) => n.id), ["a"]);
});

test("useNoteEditor: opens in preview, saves shortly after edits, cleans up with undo", async () => {
  const saves: string[] = [];
  const api: Partial<Api> = {
    note: async () => note("n1", { title: "Kasus", body: "# Dativ" }),
    notes: async () => [note("x", { category: "Grammar" })],
    saveNote: async (_id, b) => {
      saves.push(b.body ?? "");
      return note("n1");
    },
    cleanupNotes: async () => ({ text: "## Dativ" }),
    import: async () => ({ ok: true, id: "note-n1", kind: "cheatsheet" }),
  };
  const h = renderHook(() => useNoteEditor("n1"), api);
  await flush();
  assert.equal(h.current().status, "ready");
  assert.equal(h.current().mode, "preview");
  assert.deepEqual(h.current().categories, ["Grammar"]);
  assert.equal(h.current().saveState, "idle", "loading isn't a change");

  act(() => h.current().setBody("# Dativ\nmit"));
  act(() => h.current().setBody("# Dativ\nmit dem"));
  assert.equal(h.current().saveState, "saving");
  await act(() => sleep(750));
  assert.deepEqual(saves, ["# Dativ\nmit dem"], "one save for the burst of edits");
  assert.equal(h.current().saveState, "saved");

  await act(() => h.current().cleanUp());
  assert.equal(h.current().body, "## Dativ");
  act(() => h.current().undoCleanUp());
  assert.equal(h.current().body, "# Dativ\nmit dem");
  assert.equal(h.current().mode, "write");

  let sheet: string | null = null;
  await act(async () => void (sheet = await h.current().saveAsCheatsheet()));
  assert.equal(sheet, "note-n1");
  h.unmount();
});

test("useNoteEditor: deleting drops a pending save", async () => {
  const calls: string[] = [];
  const api: Partial<Api> = {
    note: async () => note("n1", { body: "x" }),
    notes: async () => [],
    saveNote: async () => void calls.push("save") as never,
    removeNote: async () => void calls.push("remove") as never,
  };
  const h = renderHook(() => useNoteEditor("n1"), api);
  await flush();
  act(() => h.current().setTitle("Neu"));
  await act(() => h.current().remove());
  await act(() => sleep(750));
  assert.deepEqual(calls, ["remove"]);
  h.unmount();
});

test("useStoryGeneration: starts at the learner's level, reports progress, resolves with the id", async () => {
  const sent: unknown[] = [];
  const api: Partial<Api> = {
    assistantStatus: async () => ({ enabled: true, model: "m" }),
    settings: async () => ({ level: "B1" }) as never,
    storyContext: async () => ({ mistakes: [], words: ["Haus"], topics: [] }) as never,
    generateStory: async (body, onProgress) => {
      sent.push(body);
      onProgress({ phase: "writing", chars: 1200 });
      return { id: "neu", questionsDropped: false };
    },
  };
  const seen: (StoryGenerationEvent | "starting" | null)[] = [];
  const h = renderHook(() => {
    const g = useStoryGeneration();
    seen.push(g.progress);
    return g;
  }, api);
  await flush();
  assert.equal(h.current().aiReady, true);
  assert.equal(h.current().level, "B1");
  assert.equal(h.current().canStart, false, "no prompt yet");
  act(() => h.current().setPrompt("  Ein Tag am See  "));
  assert.equal(h.current().canStart, true);

  let id: string | null = null;
  await act(async () => void (id = await h.current().start()));
  assert.equal(id, "neu");
  assert.deepEqual(sent[0], {
    prompt: "Ein Tag am See",
    level: "B1",
    length: "medium",
    questions: 4,
    vocabulary: "known",
    context: { mistakes: true, vocab: true, topics: false },
  });
  assert.ok(seen.some((p) => p !== null && p !== "starting" && p.phase === "writing"));
  assert.equal(storyProgressText({ phase: "writing", chars: 1200 }), `Writing… ${(1200).toLocaleString()} characters`);
  h.unmount();
});

test("useStoryGeneration: a failure shows its message and allows another try", async () => {
  const api: Partial<Api> = {
    assistantStatus: async () => ({ enabled: true, model: "m" }),
    settings: async () => ({ level: "A2" }) as never,
    storyContext: async () => ({ mistakes: [], words: [], topics: [] }) as never,
    generateStory: async () => {
      throw new Error("The AI is busy.");
    },
  };
  const h = renderHook(() => useStoryGeneration(), api);
  await flush();
  act(() => h.current().setPrompt("Ein Tag"));
  await act(async () => void (await h.current().start()));
  assert.equal(h.current().error, "The AI is busy.");
  assert.equal(h.current().busy, false);
  assert.equal(h.current().canStart, true);
  h.unmount();
});
