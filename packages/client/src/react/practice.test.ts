import assert from "node:assert/strict";
import { test } from "node:test";
import { exerciseSet, type ExerciseSet } from "@mdb/shared";
import type { Api } from "../api";
import { act, flush, renderHook } from "./testing";
import { useExerciseRunner } from "./useExerciseRunner";
import { useTutorChat } from "./useTutorChat";

const set: ExerciseSet = exerciseSet.parse({
  id: "s",
  title: "Set",
  level: "A2",
  topic: "t",
  items: [
    { id: "a", type: "true_false", statement: "x", correct: true },
    { id: "b", type: "multiple_choice", prompt: "?", choices: ["ja", "nein"], answerIndex: 1 },
  ],
});

function fakeApi(calls: string[]): Partial<Api> {
  return {
    assistantStatus: async () => ({ enabled: true, model: "m" }),
    settings: async () => ({ generateCount: 10 }) as Awaited<ReturnType<Api["settings"]>>,
    run: async () => null,
    answer: async (b) => {
      calls.push(`answer ${b.itemId}`);
      return { correct: b.itemId === "a" } as Awaited<ReturnType<Api["answer"]>>;
    },
    saveExerciseProgress: async (_id, b) => void calls.push(`progress ${b.index}`) as never,
    finishRun: async (_id, done) => void calls.push(`finish ${done}`) as never,
    generateMore: async () => ({ items: [], received: 2 }) as unknown as Awaited<ReturnType<Api["generateMore"]>>,
  };
}

test("useExerciseRunner: resumes, answers through the server, moves on and finishes", async () => {
  const calls: string[] = [];
  const h = renderHook(
    () => useExerciseRunner({ set, extra: [], initial: { index: 1, results: { a: true, gone: false }, responses: { a: "Correct" } } as never }),
    fakeApi(calls),
  );
  await flush();
  assert.equal(h.current().index, 1);
  assert.deepEqual(h.current().results, { a: true }, "results for items no longer in the set are dropped");
  assert.equal(h.current().generate.count, 10);

  await act(async () => void (await h.current().submit({ type: "multiple_choice", choice: 0 })));
  assert.equal(h.current().answered, true);
  assert.equal(h.current().lastCorrect, false);
  assert.equal(h.current().lastResponse, "ja");
  assert.equal(h.current().answeredCount, 2);
  assert.equal(h.current().correctCount, 1);

  act(() => h.current().goTo(0));
  assert.equal(h.current().answered, false, "a revisited item is open again");
  assert.equal(h.current().priorResult, true);
  act(() => h.current().goTo(1));
  act(() => h.current().next());
  assert.equal(h.current().done, true);
  h.unmount();
  assert.deepEqual(calls, ["answer b", "progress 0", "progress 1", "finish true"], "no second finish after a finished run");
});

test("useExerciseRunner: leaving partway records the run; an empty generation explains itself", async () => {
  const calls: string[] = [];
  const h = renderHook(() => useExerciseRunner({ set, extra: [], initial: null }), fakeApi(calls));
  await flush();
  await act(async () => void (await h.current().submit({ type: "true_false", value: true })));
  await act(() => h.current().generate.run());
  assert.match(h.current().generate.error ?? "", /returned 2 items but none were valid/);
  h.unmount();
  assert.deepEqual(calls, ["answer a", "finish false"]);
});

test("useTutorChat: streams a hint, then a why-wrong chat with follow-ups", async () => {
  const bodies: unknown[] = [];
  const api: Partial<Api> = {
    askAssistant: async (body, onToken) => {
      bodies.push(body);
      onToken("Schau ");
      onToken("genau.");
    },
  };
  const item = { type: "cloze", label: "Ich ___ müde.", expected: [] };
  const h = renderHook(() => useTutorChat({ item, response: "bist" }), api);

  await act(async () => h.current().hint());
  assert.deepEqual(h.current().shot, { kind: "hint", text: "Schau genau.", busy: false });

  await act(async () => h.current().whyWrong());
  assert.equal(h.current().shot, null);
  assert.deepEqual(h.current().chat?.msgs, [{ role: "assistant", content: "Schau genau." }]);

  act(() => h.current().setInput("  Warum?  "));
  await act(async () => h.current().send());
  assert.deepEqual(bodies[2], {
    task: "chat",
    item,
    response: "bist",
    history: [
      { role: "assistant", content: "Schau genau." },
      { role: "user", content: "Warum?" },
    ],
  });
  assert.equal(h.current().chat?.msgs.length, 3);
  assert.equal(h.current().chat?.input, "");

  act(() => h.current().close());
  assert.equal(h.current().chat, null);
  h.unmount();
});

test("useExerciseRunner: past the end with items left, it offers them and keeps the run open", async () => {
  const calls: string[] = [];
  const h = renderHook(() => useExerciseRunner({ set, extra: [], initial: { index: 1, results: {}, responses: {} } as never }), fakeApi(calls));
  await flush();
  await act(async () => void (await h.current().submit({ type: "multiple_choice", choice: 1 })));
  act(() => h.current().next());
  assert.equal(h.current().done, true);
  assert.equal(h.current().remaining, 1, "a was never answered");
  act(() => h.current().answerRemaining());
  assert.equal(h.current().done, false);
  assert.equal(h.current().index, 0);
  await act(async () => void (await h.current().submit({ type: "true_false", value: true })));
  act(() => h.current().goTo(1));
  act(() => h.current().next());
  assert.equal(h.current().remaining, 0);
  h.unmount();
  assert.deepEqual(calls, ["answer b", "progress 0", "answer a", "progress 1", "finish true"], "finished once, when everything was answered");
});
