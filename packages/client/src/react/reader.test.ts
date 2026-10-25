import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { storyView, type StoryView } from "@mdb/shared";
import type { Api } from "../api";
import type { Speech } from "../speech";
import { act, flush, renderHook } from "./testing";
import {
  isSavedWord,
  useReadAloud,
  useReaderSettings,
  useReadingProgress,
  useStory,
  useStoryQuiz,
  useStoryTranslations,
} from "./useStoryReader";

const view = (patch: Partial<StoryView> = {}): StoryView =>
  storyView.parse({
    story: {
      id: "kiste",
      title: "Die Kiste",
      level: "A2",
      body: "Eins.\n\nZwei.",
      questions: [{ id: "q", type: "true_false", statement: "x", correct: true }],
    },
    progress: 0.3,
    readAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  });

test("useStory: next chapter marks this one read first; read again unreads it", async () => {
  const calls: string[] = [];
  const api: Partial<Api> = {
    story: async () => view({ series: { id: "b", title: "B", chapter: 1, total: 2, prev: null, next: "kiste-2" } } as never),
    markStoryRead: async (id) => void calls.push(`read ${id}`) as never,
    readStoryAgain: async (id) => void calls.push(`unread ${id}`) as never,
  };
  const h = renderHook(() => useStory("kiste"), api);
  await flush();
  let next: string | null = null;
  await act(async () => void (next = await h.current().nextChapter()));
  assert.equal(next, "kiste-2");
  assert.equal(h.current().view?.status, "read");
  assert.equal(h.current().view?.progress, 1);
  await act(() => h.current().readAgain());
  assert.equal(h.current().view?.status, "unread");
  assert.equal(h.current().view?.readAt, null);
  assert.deepEqual(calls, ["read kiste", "unread kiste"]);
  h.unmount();
});

test("useReaderSettings: applies at once, saves the latest change once", async () => {
  const saved: unknown[] = [];
  const api: Partial<Api> = {
    settings: async () => ({ generateCount: 5, reader: { font: "serif", size: 18 } }) as never,
    saveSettings: async (s) => void saved.push(s) as never,
  };
  const h = renderHook(() => useReaderSettings(), api);
  await flush();
  act(() => h.current().change({ size: 20 }));
  act(() => h.current().change({ font: "sans" }));
  assert.equal(h.current().reader.size, 20);
  assert.equal(h.current().reader.font, "sans");
  assert.equal(saved.length, 0, "not saved yet");
  h.unmount();
  assert.equal(saved.length, 1, "saved on unmount");
  assert.deepEqual((saved[0] as { reader: unknown }).reader, { font: "sans", size: 20 });
});

test("useStoryTranslations: batches missing paragraphs, at most four at a time", async () => {
  const asked: number[][] = [];
  const api: Partial<Api> = {
    storyTranslations: async () => ({ paragraphs: [0, 1, 2, 3, 4, 5].map((index) => ({ index, lines: index === 0 ? ["One."] : null })) }) as never,
    translateStory: async (_id, paragraphs) => {
      asked.push(paragraphs);
      return { paragraphs: paragraphs.map((index) => ({ index, lines: [`Line ${index}.`] })) } as never;
    },
  };
  const h = renderHook(() => useStoryTranslations({ storyId: "kiste", enabled: true }), api);
  await flush();
  assert.equal(h.current().hasAny, true);
  act(() => h.current().request([0, 1, 2]));
  act(() => h.current().request([3, 4, 5]));
  await act(() => sleep(300));
  assert.deepEqual(asked, [[1, 2, 3, 4]], "paragraph 0 has its English already");
  assert.deepEqual(h.current().lines[4], ["Line 4."]);
  act(() => h.current().reveal("4:all"));
  assert.ok(h.current().revealed.has("4:all"));
  h.unmount();
});

test("useReadingProgress: only moves forward, with its spot, and leaving saves any step", async () => {
  const saved: unknown[] = [];
  const save = { storyProgress: async (_id: string, p: number, spot?: unknown) => void saved.push([p, spot]) as never };
  const h = renderHook(() => useReadingProgress(view()), save);
  h.current().see(0.6, { para: 4, char: 120 });
  h.current().see(0.4, { para: 2, char: 0 });
  h.unmount();
  assert.deepEqual(saved, [[0.6, { para: 4, char: 120 }]]);

  // One page further in a long story (under the 2% the timer waits for) is still saved on leaving.
  const again = renderHook(() => useReadingProgress(view()), save);
  again.current().see(0.31, { para: 1, char: 0 });
  again.unmount();
  assert.deepEqual(saved[1], [0.31, { para: 1, char: 0 }]);

  // Nothing further: nothing to save.
  const idle = renderHook(() => useReadingProgress(view()), save);
  idle.current().see(0.2);
  idle.unmount();
  assert.equal(saved.length, 2);
});

test("useStoryQuiz: records a finished quiz once per round", async () => {
  const calls: string[] = [];
  let finished = 0;
  const onFinished = () => void finished++;
  const api: Partial<Api> = {
    answer: async () => ({ correct: true }) as never,
    finishRun: async (setId, done) => void calls.push(`${setId} ${done}`) as never,
  };
  const h = renderHook(() => useStoryQuiz(view().story, onFinished), api);
  const q = view().story.questions[0]!;
  await act(async () => void (await h.current().answer(q, { type: "true_false", value: true })));
  assert.equal(h.current().done, true);
  assert.equal(h.current().correct, 1);
  act(() => h.current().retry());
  assert.equal(h.current().done, false);
  assert.equal(h.current().round, 1);
  assert.deepEqual(calls, ["story:kiste true"]);
  assert.equal(finished, 1);
  h.unmount();
});

test("useReadAloud: reads from a paragraph on and follows along", async () => {
  let sequence: { texts: string[]; onIndex?: (i: number) => void; onEnd?: () => void } | null = null;
  const speech: Partial<Speech> = {
    supported: () => true,
    stop: () => {},
    speakSequence: (texts, opts) => {
      sequence = { texts, ...opts };
      return () => {};
    },
  };
  const followed: number[] = [];
  const h = renderHook(() => useReadAloud(), {}, speech);
  act(() => h.current().read(["A.", "B.", "C."], 1, { rate: 1, onParagraph: (i) => followed.push(i) }));
  assert.deepEqual(sequence!.texts, ["B.", "C."]);
  act(() => sequence!.onIndex!(1));
  assert.equal(h.current().speaking, 2);
  assert.deepEqual(followed, [2]);
  act(() => sequence!.onEnd!());
  assert.equal(h.current().speaking, null);
  h.unmount();
});

test("isSavedWord matches the word or its base form, ignoring case", () => {
  const saved = new Set(["gehen", "haus"]);
  assert.equal(isSavedWord("ging", saved, { ging: "gehen" }), true);
  assert.equal(isSavedWord("Haus", saved, {}), true);
  assert.equal(isSavedWord("Baum", saved, {}), false);
});
