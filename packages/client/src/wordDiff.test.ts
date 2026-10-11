import { test } from "node:test";
import assert from "node:assert/strict";
import { diffText, wordDiff } from "./wordDiff";

test("wordDiff: a changed word shows as removed then added", () => {
  assert.deepEqual(wordDiff("Ich habe der Mann gesehen.", "Ich habe den Mann gesehen."), [
    { kind: "same", text: "Ich habe", gap: false },
    { kind: "removed", text: "der", gap: true },
    { kind: "added", text: "den", gap: true },
    { kind: "same", text: "Mann gesehen.", gap: true },
  ]);
});

test("wordDiff: a moved separable prefix doesn't drag the full stop along", () => {
  const d = wordDiff("Ich aufstehe um sieben Uhr.", "Ich stehe um sieben Uhr auf.");
  assert.deepEqual(
    d.map((p) => [p.kind, p.text]),
    [["same", "Ich"], ["removed", "aufstehe"], ["added", "stehe"], ["same", "um sieben Uhr"], ["added", "auf"], ["same", "."]],
  );
  assert.equal(diffText(d, "to"), "Ich stehe um sieben Uhr auf.");
  assert.equal(diffText(d, "from"), "Ich aufstehe um sieben Uhr.");
});

test("wordDiff: identical and empty", () => {
  assert.deepEqual(wordDiff("Guten Morgen", "Guten  Morgen"), [{ kind: "same", text: "Guten Morgen", gap: false }]);
  assert.deepEqual(wordDiff("", "Hallo!"), [{ kind: "added", text: "Hallo!", gap: false }]);
});
