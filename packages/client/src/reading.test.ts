import { test } from "node:test";
import assert from "node:assert/strict";
import type { SeriesSummary, StorySummary } from "@mdb/shared";
import { recentReading } from "./reading";

const story = (id: string, o: Partial<StorySummary> = {}): StorySummary => ({
  id,
  seriesId: null,
  chapter: null,
  title: id,
  level: "A2",
  tags: [],
  words: 100,
  minutes: 1,
  questions: 0,
  cover: null,
  progress: 0,
  readAt: null,
  status: "unread",
  createdAt: 0,
  updatedAt: 0,
  ...o,
});
const book = (id: string, o: Partial<SeriesSummary> = {}): SeriesSummary => ({
  id,
  title: id,
  level: "A2",
  description: "",
  written: 3,
  total: 3,
  read: 0,
  progress: 0,
  status: "unread",
  continueId: `${id}-1`,
  cover: null,
  updatedAt: 0,
  ...o,
});

test("recentReading lists what's in progress, newest first, chapters through their book", () => {
  const r = recentReading(
    [story("a", { status: "reading", progress: 0.5, updatedAt: 1 }), story("ch", { seriesId: "b", status: "reading", updatedAt: 9 }), story("u", { updatedAt: 5 })],
    [book("b", { status: "reading", progress: 0.4, updatedAt: 3, continueId: "ch" })],
    3,
  );
  assert.equal(r.reading, true);
  assert.deepEqual(r.items.map((i) => [i.id, i.storyId, i.detail]), [
    ["b", "ch", "Book · 40% read"],
    ["a", "a", "Story · 50% read"],
  ]);
});

test("recentReading falls back to the newest unread, leaving read ones out", () => {
  const r = recentReading([story("old", { updatedAt: 1 }), story("new", { updatedAt: 2 }), story("done", { status: "read", updatedAt: 3 })], [], 3);
  assert.equal(r.reading, false);
  assert.deepEqual(r.items.map((i) => i.id), ["new", "old"]);
});
