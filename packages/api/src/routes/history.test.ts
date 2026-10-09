import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-history-"));
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
  ASSISTANT_API_KEY: "",
});

let app: FastifyInstance;
before(async () => {
  const { buildApp } = await import("../app");
  app = await buildApp();
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

let ip = 0;
type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;
const call = (headers: Record<string, string>) =>
  (method: InjectOptions["method"], url: string, payload?: unknown): Promise<Res> =>
    app.inject({
      method,
      url,
      headers: { ...headers, "cf-connecting-ip": `192.0.2.${++ip % 250}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
async function session(username: string, password: string) {
  const res = await call({})("POST", "/api/auth/login", { username, password });
  assert.equal(res.statusCode, 200, res.body);
  return call({ cookie: `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}` });
}

let admin: ReturnType<typeof call>;
let anna: ReturnType<typeof call>;
const SET = "als-oder-wenn";
let itemIds: string[];

test("answers are logged with what was answered and how it was graded", async () => {
  admin = await session("yamen", "admin-password");
  itemIds = ((await admin("GET", `/api/exercises/${SET}`)).json().items as { id: string }[]).map((i) => i.id);
  const [a, b, c] = itemIds as [string, string, string];
  // The server grades: each of these gaps expects "als".
  const post = async (itemId: string, text: string, correct: boolean) => {
    const res = await admin("POST", "/api/answers", { setId: SET, itemId, response: { type: "cloze", blanks: { 1: text } } });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { correct, grading: "auto" });
  };
  await post(a, "wenn", false);
  await post(a, "wann", false);
  await post(b, "wenn", false);
  await post(b, "Als", true); // fixed since (case doesn't matter here)
  await post(c, "wenn", false);
  // An open answer with no AI tutor set up: no verdict.
  const open = await admin("POST", "/api/answers", {
    setId: "infinitiv-zu-frei", itemId: "iz-a01", response: { type: "transform", text: "Für mich ist es wichtig, viel zu reisen." },
  });
  assert.deepEqual(open.json(), { correct: true, grading: "ungraded" });

  const { db, schema } = await import("../db/client");
  const rows = db.select().from(schema.attempts).all();
  assert.deepEqual(
    rows.map((r) => [r.response, r.grading]),
    [["wenn", "auto"], ["wann", "auto"], ["wenn", "auto"], ["Als", "auto"], ["wenn", "auto"], ["Für mich ist es wichtig, viel zu reisen.", "ungraded"]],
  );
  // Unknown items, and answers of the wrong shape, are refused.
  assert.equal((await admin("POST", "/api/answers", { setId: SET, itemId: "nope", response: { type: "cloze", blanks: {} } })).statusCode, 404);
  assert.equal((await admin("POST", "/api/answers", { setId: SET, itemId: a, response: { type: "true_false", value: true } })).statusCode, 404);
});

test("progress: ungraded answers count for today, not for accuracy", async () => {
  const p = (await admin("GET", "/api/progress")).json();
  assert.equal(p.answeredToday, 6);
  assert.equal(p.totalAnswered, 5);
  assert.equal(p.totalCorrect, 1);
});

test("mistakes: unresolved by default, with the item and the wrong answers", async () => {
  const [a, b, c] = itemIds as [string, string, string];
  const open = (await admin("GET", "/api/history/mistakes")).json() as {
    itemId: string; item: { id: string } | null; responses: string[]; wrongCount: number; resolved: boolean; setTitle: string;
  }[];
  assert.deepEqual(open.map((m) => m.itemId).sort(), [a, c].sort());
  const ma = open.find((m) => m.itemId === a)!;
  assert.deepEqual(ma.responses, ["wann", "wenn"]);
  assert.equal(ma.wrongCount, 2);
  assert.equal(ma.item!.id, a);
  assert.ok(ma.setTitle);
  const all = (await admin("GET", "/api/history/mistakes?includeResolved=true")).json() as { itemId: string; resolved: boolean }[];
  assert.equal(all.find((m) => m.itemId === b)!.resolved, true);
  assert.deepEqual((await admin("GET", "/api/history/mistakes?setId=other")).json(), []);
});

test("set history: per-item totals in set order, and runs", async () => {
  // The server scores the run from the answers in this session.
  assert.equal((await admin("POST", "/api/runs", { setId: SET, done: true })).statusCode, 200);
  assert.equal((await admin("POST", "/api/runs", { setId: SET, done: true })).statusCode, 200, "nothing left to record");
  const h = (await admin("GET", `/api/history/sets/${SET}`)).json();
  assert.equal(h.runs.length, 1);
  assert.deepEqual([h.runs[0].answered, h.runs[0].correct, h.runs[0].total], [3, 1, itemIds.length]);
  assert.deepEqual(h.items.map((i: { itemId: string }) => i.itemId), itemIds.slice(0, 3));
  assert.deepEqual(h.items[1], { itemId: itemIds[1], attempts: 2, correct: 1, lastResult: true, lastResponse: "Als" });
});

test("activity: days and events, including vocab reviews and notes", async () => {
  await admin("POST", "/api/vocab", { word: "Haus", display: "das Haus", translation: "house" });
  await admin("POST", "/api/vocab/haus/study", { known: true });
  await admin("POST", "/api/vocab/haus/study", { known: false });
  await admin("POST", "/api/notes", { title: "Dativ" });
  await admin("POST", "/api/sheet-views", { sheetId: "dativ", title: "Dativ" });

  const v = (await admin("GET", "/api/history/activity")).json();
  assert.equal(v.timezone, "UTC");
  assert.equal(v.days.length, 1);
  assert.deepEqual({ ...v.days[0], date: undefined }, { date: undefined, answered: 6, correct: 1, wordsAdded: 1, wordsReviewed: 2 });
  assert.deepEqual(
    v.events.map((e: { kind: string }) => e.kind).sort(),
    ["note_created", "run", "sheet_viewed", "word_added"],
  );
  assert.equal(v.events.find((e: { kind: string }) => e.kind === "run").detail, `1/${itemIds.length}`);
  assert.deepEqual((await admin("GET", "/api/history/activity?from=2020-01-01&to=2020-01-31")).json().days, []);
  assert.equal((await admin("GET", "/api/history/activity?from=yesterday")).statusCode, 400);

  // Deleting a word deletes its review log too.
  const { db, schema } = await import("../db/client");
  await admin("DELETE", "/api/vocab/haus");
  assert.equal(db.select().from(schema.vocabReviews).all().length, 0);
});

test("history is private", async () => {
  await admin("PUT", "/api/admin/registration", { open: true });
  await call({})("POST", "/api/auth/register", { username: "anna", password: "anna-password" });
  anna = await session("anna", "anna-password");
  assert.deepEqual((await anna("GET", "/api/history/mistakes")).json(), []);
  assert.deepEqual((await anna("GET", `/api/history/sets/${SET}`)).json().items, []);
  assert.deepEqual((await anna("GET", "/api/history/activity")).json().days, []);
});

test("time zone: admin only, validated, and moves the day boundary", async () => {
  assert.equal((await anna("GET", "/api/admin/timezone")).statusCode, 403);
  assert.equal((await anna("PUT", "/api/admin/timezone", { timezone: "Europe/Berlin" })).statusCode, 403);
  assert.deepEqual((await admin("GET", "/api/admin/timezone")).json(), { timezone: "UTC" });
  assert.equal((await admin("PUT", "/api/admin/timezone", { timezone: "Mars/Olympus" })).statusCode, 400);
  assert.deepEqual((await admin("PUT", "/api/admin/timezone", { timezone: "Pacific/Kiritimati" })).json(), {
    timezone: "Pacific/Kiritimati",
  });

  // An answer at 23:30 UTC yesterday is "today" in UTC+14, not in UTC.
  const { db, schema } = await import("../db/client");
  const { dayKey, getTimezone } = await import("../services/timezone");
  const now = Date.now() / 1000;
  const lateLastNight = Math.floor(now / 86400) * 86400 - 1800;
  const { id: annaId } = db.select().from(schema.users).all().find((u) => u.username === "anna")!;
  db.insert(schema.attempts).values({ userId: annaId, setId: SET, itemId: "x", correct: true, answeredAt: new Date(lateLastNight * 1000) }).run();
  const kiritimatiDayStarted = dayKey(now, getTimezone()) === dayKey(lateLastNight, getTimezone());
  assert.equal((await anna("GET", "/api/progress")).json().answeredToday, kiritimatiDayStarted ? 1 : 0);
  await admin("PUT", "/api/admin/timezone", { timezone: "UTC" });
  assert.equal((await anna("GET", "/api/progress")).json().answeredToday, 0);
});
