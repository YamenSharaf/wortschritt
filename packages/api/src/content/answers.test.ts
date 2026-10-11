import assert from "node:assert/strict";
import { test } from "node:test";
import { exerciseItem, gradeItem, responseText, withoutTutor, type ExerciseItem } from "@mdb/shared";

const item = (x: unknown): ExerciseItem => exerciseItem.parse(x);

test("gradeItem: each type by its own rules", () => {
  const mc = item({ id: "mc", type: "multiple_choice", prompt: "?", choices: ["a", "b"], answerIndex: 1 });
  assert.equal(gradeItem(mc, { type: "multiple_choice", choice: 1 }).correct, true);
  assert.equal(gradeItem(mc, { type: "multiple_choice", choice: 0 }).correct, false);
  assert.equal(responseText(mc, { type: "multiple_choice", choice: 0 }), "a");

  const cloze = item({
    id: "c", type: "cloze", text: "Ich {{1}} nach Hause {{2}}.",
    blanks: [{ ref: "1", answer: { accept: ["bin"] } }, { ref: "2", answer: { accept: ["gegangen"] } }],
  });
  assert.equal(gradeItem(cloze, { type: "cloze", blanks: { 1: "Bin", 2: "gegangen." } }).correct, true, "lenient by default");
  assert.equal(gradeItem(cloze, { type: "cloze", blanks: { 1: "bin" } }).correct, false, "every blank must match");
  assert.equal(responseText(cloze, { type: "cloze", blanks: { 1: "bin", 2: "ging" } }), "bin / ging");

  const tf = item({ id: "t", type: "true_false", statement: "x", correct: false });
  assert.equal(gradeItem(tf, { type: "true_false", value: false }).correct, true);

  const card = item({ id: "f", type: "flashcard", front: "der Hund", back: "dog" });
  assert.deepEqual(gradeItem(card, { type: "flashcard", knew: true }), { correct: true, grading: "self" });

  const table = item({
    id: "k", type: "conjugation_table", rows: ["ich", "du"],
    columns: [{ header: "Präsens", answers: ["gehe", "gehst"] }, { header: "Präteritum", answers: ["ging", "gingst"] }],
  });
  const cells = [["gehe", "gehst"], ["ging", "gingst"]];
  assert.equal(gradeItem(table, { type: "conjugation_table", cells }).correct, true);
  assert.equal(gradeItem(table, { type: "conjugation_table", cells: [["gehe", "gehst"], ["ging", ""]] }).correct, false);
  assert.equal(responseText(table, { type: "conjugation_table", cells }), "ich: gehe / ging; du: gehst / gingst");

  assert.throws(() => gradeItem(mc, { type: "true_false", value: true }), /true_false answer to a multiple_choice item/);
});

test("free text: a miss is left for the tutor; without one, open answers are ungraded", () => {
  const strict = item({ id: "s", type: "transform", source: "Er geht.", answer: { accept: ["Er ging."] } });
  const hit = gradeItem(strict, { type: "transform", text: "er ging" });
  assert.deepEqual(hit, { correct: true, grading: "auto" });
  const miss = gradeItem(strict, { type: "transform", text: "Er gehte." });
  assert.equal(miss.textMiss?.text, "Er gehte.");
  assert.deepEqual(withoutTutor(miss), { correct: false, grading: "auto" });

  const open = item({ id: "o", type: "sentence_build", answer: { accept: ["Ich lerne Deutsch."], grading: "open" } });
  assert.deepEqual(withoutTutor(gradeItem(open, { type: "sentence_build", text: "Ich mag Deutsch." })), { correct: true, grading: "ungraded" });
});

test("translate: a match is right; a miss waits for a judge; the learner's own check is self-graded", () => {
  const tr = item({
    id: "tr", type: "translate", english: "I forgot my keys.",
    words: [{ en: "the key", de: "der Schlüssel" }],
    answer: { accept: ["Ich habe meine Schlüssel vergessen."] },
  });
  assert.deepEqual(gradeItem(tr, { type: "translate", text: "ich habe meine schlussel vergessen" }), { correct: true, grading: "auto" });
  const miss = gradeItem(tr, { type: "translate", text: "Meine Schlüssel habe ich vergessen." });
  assert.equal(miss.textMiss?.text, "Meine Schlüssel habe ich vergessen.");
  assert.deepEqual(withoutTutor(miss), { correct: false, grading: "ungraded", selfCheck: true }, "no tutor: ask the learner");
  assert.deepEqual(gradeItem(tr, { type: "translate", text: "Meine Schlüssel habe ich vergessen.", selfCheck: true }), { correct: true, grading: "self" });
  assert.deepEqual(withoutTutor(gradeItem(tr, { type: "translate", text: "Ich vergessen Schlüssel.", selfCheck: false })), { correct: false, grading: "self" });
  assert.equal(responseText(tr, { type: "translate", text: "Ich habe …" }), "Ich habe …");
});
