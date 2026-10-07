import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  buildImportPrompt,
  buildStoryPrompt,
  cheatsheet,
  EXAMPLE_CHEATSHEET,
  EXAMPLE_ITEMS,
  EXAMPLE_SET,
  EXAMPLE_STORY,
  EXERCISE_TYPES,
  exerciseItem,
  exerciseSet,
  gradeText,
  isOpenAnswer,
  itemFormatGuide,
  story,
} from "@mdb/shared";

const contentDir = resolve(import.meta.dirname, "../../../../content");
const jsonFiles = (sub: string) =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, JSON.parse(readFileSync(join(contentDir, sub, f), "utf8"))] as const);

/** Issues as "path: message" lines, for readable assertion failures. */
function issues(r: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }) {
  return r.success ? [] : r.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

// --- shipped content -----------------------------------------------------------

test("every shipped exercise set and cheat sheet passes the (stricter) schemas", () => {
  for (const [f, data] of jsonFiles("exercises")) {
    assert.deepEqual(issues(exerciseSet.safeParse(data)), [], f);
  }
  for (const [f, data] of jsonFiles("cheatsheets")) {
    assert.deepEqual(issues(cheatsheet.safeParse(data)), [], f);
  }
});

// --- new structural rules ------------------------------------------------------

const set = (items: unknown[]) => ({ id: "t", title: "T", level: "A1", items });
const mc = (over: object = {}) => ({
  type: "multiple_choice", id: "q1", prompt: "Ich sehe ___ Hund.",
  choices: ["der", "den", "dem"], answerIndex: 1, ...over,
});

test("multiple_choice: answerIndex must point at a choice", () => {
  assert.deepEqual(issues(exerciseSet.safeParse(set([mc()]))), []);
  assert.match(issues(exerciseSet.safeParse(set([mc({ answerIndex: 3 })])))[0]!, /answerIndex 3 is out of range/);
});

test("multiple_choice: choices must be distinct", () => {
  assert.match(
    issues(exerciseSet.safeParse(set([mc({ choices: ["den", "dem", "den "] })])))[0]!,
    /distinct/,
  );
});

test("item ids must be unique within a set", () => {
  const r = issues(exerciseSet.safeParse(set([mc(), mc({ prompt: "Ich kaufe ___ Tisch." })])));
  assert.deepEqual(r, ['items.1.id: Duplicate item id "q1" (ids must be unique within a set)']);
});

test("conjugation_table: empty cells are rejected", () => {
  const item = {
    type: "conjugation_table", id: "c", rows: ["ich", "du"],
    columns: [{ header: "sein", answers: ["bin", ""] }],
  };
  assert.ok(!exerciseSet.safeParse(set([item])).success);
});

// --- grading -------------------------------------------------------------------

test("gradeText: lenient by default, exact only ignores surrounding whitespace", () => {
  const lenient = { accept: ["Ich muss gehen."], grading: "normalized" as const };
  assert.ok(gradeText("ich MUSS gehen", lenient));
  assert.ok(gradeText("Ich mus gehen", lenient) === false);
  assert.ok(gradeText("Ich muss gehen", { ...lenient, grading: "caseInsensitive" }));

  const exact = { accept: ["Müller"], grading: "exact" as const };
  assert.ok(gradeText("  Müller ", exact), "surrounding spaces ignored");
  assert.ok(!gradeText("müller", exact));
  assert.ok(!gradeText("Muller", exact));
});

// --- the LLM authoring guide ---------------------------------------------------

test("the guide has one valid example per item type", () => {
  assert.deepEqual(
    EXAMPLE_ITEMS.map((i) => i.type).sort(),
    [...EXERCISE_TYPES].sort(),
  );
  assert.deepEqual(issues(exerciseSet.safeParse(EXAMPLE_SET)), []);
  assert.deepEqual(issues(cheatsheet.safeParse(EXAMPLE_CHEATSHEET)), []);
  assert.deepEqual(issues(story.safeParse(EXAMPLE_STORY)), []);
});

test("no example value is filler a model could copy verbatim", () => {
  const filler = /\b(optional|\.\.\.|TODO|lorem)\b|\|/i;
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      // Markdown tables in cheat sheet bodies legitimately contain "|".
      if (!path.endsWith(".body")) assert.ok(!filler.test(v), `${path}: "${v}"`);
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    }
  };
  walk(EXAMPLE_SET, "set");
  walk(EXAMPLE_CHEATSHEET, "sheet");
  walk(EXAMPLE_STORY, "story");
});

test("story prompt: the example in it is a valid story", () => {
  const prompt = buildStoryPrompt();
  const json = prompt.slice(prompt.indexOf("{"), prompt.indexOf("\n}\n") + 2);
  assert.deepEqual(issues(story.safeParse(JSON.parse(json))), []);
  assert.match(prompt, /blank line/);
});

test("story questions get the same checks as exercise sets", () => {
  const bad = {
    ...EXAMPLE_STORY,
    questions: [
      { id: "q1", type: "multiple_choice", prompt: "?", choices: ["a", "b"], answerIndex: 2 },
      { id: "q1", type: "true_false", statement: "x", correct: true },
    ],
  };
  const found = issues(story.safeParse(bad));
  assert.ok(found.some((i) => i.startsWith("questions.0.answerIndex")), found.join("\n"));
  assert.ok(found.some((i) => i.startsWith("questions.1.id")), found.join("\n"));
  assert.ok(issues(story.safeParse({ ...EXAMPLE_STORY, id: "Mein Tag" })).some((i) => i.startsWith("id")));
});

/** The JSON object lines printed by itemFormatGuide. */
const exampleLines = (guide: string) =>
  guide.split("\n").filter((l) => l.startsWith(`{"type":`)).map((l) => JSON.parse(l));

test("import prompt: every item example in it parses and validates", () => {
  const prompt = buildImportPrompt("exercise");
  const items = exampleLines(prompt);
  assert.equal(items.length, EXERCISE_TYPES.length);
  for (const item of items) {
    assert.deepEqual(issues(exerciseItem.safeParse(item)), [], item.type);
  }
  assert.deepEqual(issues(exerciseSet.safeParse(set(items))), []);
  // Mentions the fields and rules the old prompt left out.
  for (const s of ['"context"', '"hint"', '"instructions"', "MUST list the words", "Free answers", "unique within the set"]) {
    assert.ok(prompt.includes(s), s);
  }
});

test("import prompt: the cheat sheet example parses and validates", () => {
  const prompt = buildImportPrompt("cheatsheet");
  const json = prompt.slice(prompt.indexOf("{"), prompt.indexOf("\n}\n") + 2);
  assert.deepEqual(issues(cheatsheet.safeParse(JSON.parse(json))), []);
});

test("generation guide: same examples, without ids", () => {
  const items = exampleLines(itemFormatGuide({ withIds: false }));
  assert.equal(items.length, EXERCISE_TYPES.length);
  for (const item of items) {
    assert.ok(!("id" in item));
    assert.ok(exerciseItem.safeParse({ ...item, id: "x" }).success, item.type);
  }
});

// --- open-ended answers --------------------------------------------------------

test('"open" grading: allowed on transform and sentence_build, refused on cloze', () => {
  const open = { accept: ["Für mich ist es wichtig, viel zu lesen."], grading: "open" };
  const transform = { type: "transform", id: "t", source: "Für mich ist es wichtig, …", answer: open };
  const build = { type: "sentence_build", id: "b", hint: "Wörter: frei", answer: open };
  assert.deepEqual(issues(exerciseSet.safeParse(set([transform, build]))), []);

  const cloze = {
    type: "cloze", id: "c", text: "Ich {{1}} gern.",
    blanks: [{ ref: "1", answer: { accept: ["lese"], grading: "open" } }],
  };
  assert.match(issues(exerciseSet.safeParse(set([cloze])))[0]!, /only for transform and sentence_build/);
});

test('"open" grading: examples still match leniently; isOpenAnswer tells them apart', () => {
  const open = { accept: ["Für mich ist es wichtig, viel zu lesen."], grading: "open" as const };
  assert.ok(gradeText("für mich ist es wichtig, viel zu lesen", open));
  assert.ok(!gradeText("Für mich ist es wichtig, oft zu reisen.", open), "other answers aren't final locally");
  assert.ok(isOpenAnswer(open));
  assert.ok(!isOpenAnswer({ accept: ["x"], grading: "normalized" }));
});

test("the free-answer example inside the authoring guide is valid", () => {
  const guide = itemFormatGuide({ withIds: true });
  const raw = guide.slice(guide.indexOf('{"type":"transform","instructions":"Vervollständige'));
  const json = raw.slice(0, raw.indexOf("}}") + 2);
  const item = { ...JSON.parse(json), id: "x" };
  assert.deepEqual(issues(exerciseSet.safeParse(set([item]))), []);
  assert.equal(item.answer.grading, "open");
});
