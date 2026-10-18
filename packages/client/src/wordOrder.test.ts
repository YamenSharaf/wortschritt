import { test } from "node:test";
import assert from "node:assert/strict";
import { dropIndex, moveWord, within } from "./wordOrder";

// Two lines: [Wenn][ich][viel Zeit] / [hätte,][würde]
const box = (x: number, y: number, width: number) => ({ x, y, width, height: 40 });
const boxes = [box(0, 0, 60), box(70, 0, 40), box(120, 0, 90), box(0, 50, 70), box(80, 50, 60)];

test("dropIndex: before the first word whose middle is right of the point", () => {
  assert.equal(dropIndex(boxes, { x: 5, y: 20 }), 0);
  assert.equal(dropIndex(boxes, { x: 50, y: 20 }), 1);
  assert.equal(dropIndex(boxes, { x: 95, y: 20 }), 2);
  assert.equal(dropIndex(boxes, { x: 300, y: 20 }), 3, "end of the first line");
});

test("dropIndex: the second line, and between or around lines", () => {
  assert.equal(dropIndex(boxes, { x: 0, y: 70 }), 3);
  assert.equal(dropIndex(boxes, { x: 100, y: 70 }), 4);
  assert.equal(dropIndex(boxes, { x: 300, y: 70 }), 5);
  assert.equal(dropIndex(boxes, { x: 100, y: -30 }), 2, "above: the first line");
  assert.equal(dropIndex(boxes, { x: 0, y: 200 }), 5, "below: at the end");
  assert.equal(dropIndex([], { x: 0, y: 0 }), 0);
});

test("moveWord: insert, reorder, take out", () => {
  assert.deepEqual(moveWord([3, 1], 4, 1), [3, 4, 1]);
  assert.deepEqual(moveWord([3, 1, 4], 4, 0), [4, 3, 1]);
  assert.deepEqual(moveWord([3, 1, 4], 3, 2), [1, 4, 3]);
  assert.deepEqual(moveWord([3, 1, 4], 1, null), [3, 4]);
  assert.deepEqual(moveWord([3], 1, 9), [3, 1]);
});

test("within: with slack", () => {
  assert.ok(within(box(0, 0, 60), { x: 70, y: 0 }, 12));
  assert.ok(!within(box(0, 0, 60), { x: 70, y: 0 }));
});
