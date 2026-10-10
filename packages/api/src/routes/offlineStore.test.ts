import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryOfflineStore, sqliteOfflineStore, type OfflineStore } from "@mdb/client";
import { sqliteForTests } from "./sqliteForTests";
import type { SyncOp } from "@mdb/shared";

const op = (opId: string): SyncOp => ({ opId, type: "vocabRemove", word: opId });

const stores: [string, () => OfflineStore][] = [
  ["memory", memoryOfflineStore],
  ["sqlite", () => sqliteOfflineStore(async () => sqliteForTests())],
];

for (const [name, make] of stores) {
  test(`${name} store: documents by collection and id`, async () => {
    const s = make();
    assert.equal(await s.get("notes", "a"), null);
    await s.put("notes", "a", { id: "a", title: "It's \"quoted\"" });
    await s.put("notes", "a", { id: "a", title: "replaced" });
    await s.put("notes", "b", { id: "b" });
    await s.put("stories", "a", { other: true });
    assert.deepEqual(await s.get("notes", "a"), { id: "a", title: "replaced" });
    assert.equal((await s.all("notes")).length, 2);
    await s.remove("notes", "b");
    assert.equal((await s.all("notes")).length, 1);
    await s.clear(["notes"]);
    assert.equal((await s.all("notes")).length, 0);
    assert.deepEqual(await s.get("stories", "a"), { other: true }, "other collections stay");
  });

  test(`${name} store: a failed transaction leaves nothing behind`, async () => {
    const s = make();
    await s.put("meta", "cursor", "1");
    await assert.rejects(
      s.transaction(async () => {
        await s.put("meta", "cursor", "2");
        await s.put("notes", "x", {});
        throw new Error("boom");
      }),
    );
    assert.equal(await s.get("meta", "cursor"), "1");
    assert.equal(await s.get("notes", "x"), null);
    assert.equal(await s.transaction(async () => (await s.put("meta", "cursor", "3"), "done")), "done");
    assert.equal(await s.get("meta", "cursor"), "3");
  });

  test(`${name} store: the outbox keeps its order`, async () => {
    const s = make();
    for (const id of ["op-0001", "op-0002", "op-0003", "op-0004"]) await s.enqueue(op(id));
    assert.equal(await s.pendingCount(), 4);
    assert.deepEqual((await s.pending(2)).map((o) => o.opId), ["op-0001", "op-0002"]);
    await s.replacePending("op-0002", { opId: "op-0002", type: "vocabRemove", word: "changed" });
    await s.replacePending("op-0003", null);
    await s.dequeue(["op-0001"]);
    const left = await s.pending();
    assert.deepEqual(left.map((o) => o.opId), ["op-0002", "op-0004"]);
    assert.equal((left[0] as Extract<SyncOp, { type: "vocabRemove" }>).word, "changed", "replaced in place");
    await s.put("notes", "a", {});
    await s.reset();
    assert.equal(await s.pendingCount(), 0);
    assert.equal(await s.get("notes", "a"), null);
  });
}
