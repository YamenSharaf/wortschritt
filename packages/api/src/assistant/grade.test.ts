import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The grader's module loads the server's settings.
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_PASSWORD: "test-password",
  SESSION_SECRET: "test-session-secret",
  DATABASE_PATH: join(mkdtempSync(join(tmpdir(), "mdb-grade-")), "app.db"),
});
const { parseTranslationVerdict, parseVerdict } = await import("./grade");

test("translation verdicts: read from fences, prose and other wordings", () => {
  const want = { verdict: "almost", corrected: "Ich habe meine Schlüssel vergessen.", feedback: "Plural: meine." };
  assert.deepEqual(parseTranslationVerdict(JSON.stringify(want)), want);
  assert.deepEqual(parseTranslationVerdict("```json\n" + JSON.stringify(want) + "\n```"), want);
  assert.deepEqual(parseTranslationVerdict(`Let me check {the words}. Verdict:\n${JSON.stringify(want)}`), want, "a non-JSON brace first");
  assert.equal(parseTranslationVerdict('{"verdict": "Correct", "corrected": "", "feedback": "Fine."}')?.verdict, "correct");
  assert.equal(parseTranslationVerdict('{"verdict": "partially correct", "feedback": "One ending."}')?.verdict, "almost");
  assert.equal(parseTranslationVerdict('{"verdict": "incorrect"}')?.verdict, "wrong");
  assert.equal(parseTranslationVerdict('{"correct": true, "feedback": "ok"}')?.verdict, "correct");
  assert.deepEqual(parseTranslationVerdict('{"verdict": "almost", "feedback": "Use {den}."}')?.feedback, "Use {den}.", "braces inside strings");
  assert.equal(parseTranslationVerdict("Looks fine to me."), null);
  assert.equal(parseTranslationVerdict('{"verdict": "maybe"}'), null);
});

test("answer verdicts: JSON, a reply cut off mid-JSON (never shown raw), prose", () => {
  assert.deepEqual(parseVerdict('{"correct": false, "feedback": "Use „würde“."}'), { correct: false, feedback: "Use „würde“." });
  assert.deepEqual(parseVerdict('Thinking {a}. ```json\n{"correct": true, "feedback": "Gut."}\n```'), { correct: true, feedback: "Gut." });
  assert.deepEqual(parseVerdict('{"correct": false, "feedback'), { correct: false, feedback: "" });
  assert.deepEqual(parseVerdict('{"correct": false, "feedback": "Mit \\"essen\\" brauchst du'), { correct: false, feedback: 'Mit "essen" brauchst du…' });
  assert.deepEqual(parseVerdict('{"correct": tr'), { correct: false, feedback: "" });
  assert.deepEqual(parseVerdict("Das ist richtig."), { correct: true, feedback: "Das ist richtig." });
});
