import { test } from "node:test";
import assert from "node:assert/strict";
import { englishParts, presetAsGerman } from "./englishWords";

test("englishParts: words are tappable; presets are found as phrases", () => {
  const parts = englishParts("We're looking forward to the holidays.", [
    { en: "to look forward to", de: "sich freuen auf" },
    { en: "looking forward to", de: "sich freuen auf" },
    { en: "the holidays", de: "die Ferien" },
  ]);
  assert.deepEqual(
    parts.map((p) => (p.kind === "word" ? `[${p.text}${p.preset ? "*" : ""}]` : p.text)).join(""),
    "[We're] [looking forward to*] [the holidays*].",
  );
});

test("englishParts: a preset not in the sentence is simply not underlined", () => {
  const parts = englishParts("I forgot my keys.", [{ en: "to forget", de: "vergessen" }]);
  assert.equal(parts.filter((p) => p.kind === "word" && p.preset).length, 0);
  assert.equal(parts.map((p) => p.text).join(""), "I forgot my keys.");
});

test("presetAsGerman: the article and sich come off the lemma", () => {
  assert.deepEqual(presetAsGerman({ en: "the station", de: "der Bahnhof" }), { de: "der Bahnhof", lemma: "Bahnhof", en: "the station", article: "der", pos: "noun" });
  assert.equal(presetAsGerman({ en: "hurry", de: "sich beeilen" }).lemma, "beeilen");
});
