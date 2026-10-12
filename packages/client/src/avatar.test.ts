import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarFor, shuffleSeed } from "./avatar";

test("avatar: a stable, mirrored pattern per name and seed; a letter on request", () => {
  const a = avatarFor({ key: "yamen" });
  assert.deepEqual(avatarFor({ key: "Yamen" }), a, "the same for the same user");
  assert.equal(a.cells.length, 5);
  for (const row of a.cells) assert.deepEqual(row, [...row].reverse(), "mirrored");
  const on = a.cells.flat().filter(Boolean).length;
  assert.ok(on >= 8 && on <= 17);
  assert.notDeepEqual(avatarFor({ key: "yamen", seed: 7 }).cells, a.cells, "another seed, another pattern");

  const l = avatarFor({ key: "yamen", name: "Ölaf", style: "letter" });
  assert.equal(l.cells.length, 7);
  assert.deepEqual(l.cells[6], [false, true, true, true, false], "an O, accents dropped");
  assert.equal(avatarFor({ key: "x", name: "42", style: "letter" }).cells[0]!.join(), avatarFor({ key: "y", name: "!!", style: "letter" }).cells[0]!.join());
  assert.notEqual(shuffleSeed(3), 3);
});
