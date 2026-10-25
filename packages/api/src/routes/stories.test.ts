import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import { EXAMPLE_STORY } from "@mdb/shared";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-stories-"));
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
type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;
let me: (method: InjectOptions["method"], url: string, payload?: unknown) => Promise<Res>;
before(async () => {
  const { buildApp } = await import("../app");
  app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "yamen", password: "admin-password" } });
  const cookie = `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`;
  me = (method, url, payload) =>
    app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const ID = EXAMPLE_STORY.id;

test("create, list, read; a second create with the same id is refused", async () => {
  const created = await me("POST", "/api/stories", { story: EXAMPLE_STORY });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(created.json().story.glossary.length, 2);
  assert.equal(created.json().progress, 0);
  const [summary] = (await me("GET", "/api/stories")).json();
  assert.equal(summary.id, ID);
  assert.equal(summary.questions, 2);
  assert.ok(summary.words > 40 && summary.words < 70, String(summary.words));
  assert.equal((await me("POST", "/api/stories", { story: EXAMPLE_STORY })).statusCode, 409);
  assert.equal((await me("GET", "/api/stories/nope")).statusCode, 404);
});

test("malformed stories are rejected with the exact problem", async () => {
  const bad = { ...EXAMPLE_STORY, id: "Kein Slug", questions: [{ id: "q1", type: "multiple_choice", prompt: "?", choices: ["a"], answerIndex: 3 }] };
  const res = await me("POST", "/api/stories", { story: bad });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /lowercase slug/);
  assert.match(res.body, /answerIndex 3 is out of range/);
});

test("edit keeps progress; the id can't change; overwrite via create", async () => {
  await me("PUT", `/api/stories/${ID}/progress`, { progress: 0.4 });
  const edited = await me("PUT", `/api/stories/${ID}`, { ...EXAMPLE_STORY, title: "Ein Sonntag am Meer" });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().story.title, "Ein Sonntag am Meer");
  assert.equal(edited.json().progress, 0.4);
  assert.equal((await me("PUT", `/api/stories/${ID}`, { ...EXAMPLE_STORY, id: "anders" })).statusCode, 400);
  const over = await me("POST", "/api/stories", { story: EXAMPLE_STORY, overwrite: true });
  assert.equal(over.json().story.title, EXAMPLE_STORY.title);
  assert.equal(over.json().progress, 0.4);
});

test("progress and read state; reader settings are saved per account", async () => {
  const view = async () => (await me("GET", `/api/stories/${ID}`)).json();
  // Progress only moves forward; the server says where to reopen.
  // The exact spot goes with the further position, and only with it.
  await me("PUT", `/api/stories/${ID}/progress`, { progress: 0.5, spot: { para: 3, char: 40 } });
  await me("PUT", `/api/stories/${ID}/progress`, { progress: 0.3, spot: { para: 1, char: 0 } });
  let v = await view();
  assert.deepEqual([v.progress, v.status, v.resumeAt, v.resumeSpot], [0.5, "reading", 0.5, { para: 3, char: 40 }]);
  assert.ok(v.minutes >= 1, "reading time from the server");
  // Further without a spot (an older client): the fraction alone.
  await me("PUT", `/api/stories/${ID}/progress`, { progress: 0.6 });
  v = await view();
  assert.deepEqual([v.resumeAt, v.resumeSpot], [0.6, null]);

  // Reaching the end counts as read: no resume point, reopen at the top.
  await me("PUT", `/api/stories/${ID}/progress`, { progress: 0.99, spot: { para: 9, char: 0 } });
  v = await view();
  assert.deepEqual([v.progress, v.status, v.resumeAt, v.resumeSpot], [1, "read", null, null]);
  assert.ok(v.readAt);

  // Marking it read as well changes nothing.
  assert.equal((await me("POST", `/api/stories/${ID}/read`)).statusCode, 200);
  v = await view();
  assert.deepEqual([v.progress, v.status, v.resumeAt], [1, "read", null]);
  assert.ok(v.readAt);
  // "Read again": unread, back to the start (the only way progress goes back).
  assert.equal((await me("DELETE", `/api/stories/${ID}/read`)).statusCode, 200);
  v = await view();
  assert.deepEqual([v.progress, v.status, v.readAt], [0, "unread", null]);
  assert.equal((await me("GET", "/api/stories")).json().find((s: { id: string }) => s.id === ID).status, "unread");
  assert.equal((await me("POST", "/api/stories/nope/read")).statusCode, 404);
  assert.equal((await me("PUT", `/api/stories/${ID}/progress`, { progress: 2 })).statusCode, 400);

  const settings = (await me("GET", "/api/settings")).json();
  assert.equal(settings.reader.font, "serif");
  await me("PUT", "/api/settings", { ...settings, reader: { ...settings.reader, theme: "sepia", size: 22 } });
  const after = (await me("GET", "/api/settings")).json().reader;
  assert.equal(after.theme, "sepia");
  assert.equal(after.size, 22);
});

test("answers to a story's questions show up in history with the question", async () => {
  const q = EXAMPLE_STORY.questions![0]!;
  assert.equal(q.type, "true_false");
  const wrong = { type: "true_false", value: !(q as { correct: boolean }).correct };
  const v = (await me("POST", "/api/answers", { setId: `story:${ID}`, itemId: q.id, response: wrong })).json();
  assert.deepEqual(v, { correct: false, grading: "auto" });
  assert.equal((await me("GET", `/api/stories/${ID}`)).json().status, "unread");
  await me("POST", "/api/runs", { setId: `story:${ID}`, done: true });
  // Finishing the questions means the story was read.
  assert.equal((await me("GET", `/api/stories/${ID}`)).json().status, "read");
  const [m] = (await me("GET", "/api/history/mistakes")).json();
  assert.equal(m.setId, `story:${ID}`);
  assert.equal(m.setTitle, EXAMPLE_STORY.title);
  assert.equal(m.item.id, q.id);
  const h = (await me("GET", `/api/history/sets/story:${ID}`)).json();
  assert.equal(h.runs.length, 1);
  const kinds = (await me("GET", "/api/history/activity")).json().events.map((e: { kind: string }) => e.kind);
  assert.ok(kinds.includes("story_added"));
  assert.ok(kinds.includes("run"));
});

test("lemmas: base forms for underlining saved words", async () => {
  const res = await me("POST", "/api/dict/lemmas", { words: ["ging", "Häuser", "xyzzy"] });
  assert.equal(res.statusCode, 200);
  const map = res.json();
  assert.equal(map.ging, "gehen");
  assert.equal(map["Häuser"], "Haus");
  assert.equal(map.xyzzy, undefined);
});

test("delete", async () => {
  assert.equal((await me("DELETE", `/api/stories/${ID}`)).statusCode, 200);
  assert.equal((await me("DELETE", `/api/stories/${ID}`)).statusCode, 404);
  assert.deepEqual((await me("GET", "/api/stories")).json(), []);
});
