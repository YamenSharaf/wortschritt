import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import {
  createApi,
  createOfflineApi,
  createSync,
  sqliteOfflineStore,
  type Api,
  type FetchLike,
  type OfflineStore,
  type Sync,
} from "@mdb/client";
import { EXAMPLE_STORY, story as storySchema, type ExerciseItem } from "@mdb/shared";
import { sqliteForTests } from "./sqliteForTests";

// The app's offline layer (@mdb/client/offline) against the real server: the
// outbox, the change feed and the merge rules end to end. See auth.test.ts
// for the throwaway database.
const dir = mkdtempSync(join(tmpdir(), "mdb-offline-"));
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
  ASSISTANT_API_KEY: "",
  DICTIONARY_API_URL: "off",
});

let app: FastifyInstance;
let cookie = "";

/** The network as the app sees it: off (no answer at all), or a push whose response is lost. */
const net = { online: true, losePushResponse: false };

const fetchVia: FetchLike = async (url, init) => {
  if (!net.online) throw new TypeError("Network request failed");
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  const res = await app.inject({
    method: (init.method ?? "GET") as "GET",
    url: path,
    headers: { ...(init.headers ?? {}), cookie },
    ...(init.body === undefined ? {} : { payload: init.body }),
  });
  if (net.losePushResponse && path.startsWith("/api/sync/push")) {
    net.losePushResponse = false;
    throw new TypeError("Network request failed"); // applied on the server, but the app never hears
  }
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300,
    status: res.statusCode,
    statusText: res.statusMessage,
    json: async () => res.json(),
    body: null,
  };
};

let server: Api; // straight to the server (what the web does)
let store: OfflineStore;
let sync: Sync;
let offline: Api; // what the app's screens use

before(async () => {
  const { buildApp } = await import("../app");
  app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "yamen", password: "admin-password" } });
  cookie = `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`;
  server = createApi({ baseUrl: "http://test", fetch: fetchVia });
  store = sqliteOfflineStore(async () => sqliteForTests()); // the app's store, on better-sqlite3
  sync = createSync({ api: server, store });
  offline = createOfflineApi({ api: server, store, sync });
  await server.createStory(storySchema.parse(EXAMPLE_STORY));
});
after(async () => {
  sync.stop();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A library set with a multiple-choice item, and that item. */
async function mcItem(): Promise<{ setId: string; item: Extract<ExerciseItem, { type: "multiple_choice" }> }> {
  for (const set of await offline.exercises()) {
    const item = set.items.find((i): i is Extract<ExerciseItem, { type: "multiple_choice" }> => i.type === "multiple_choice");
    if (item) return { setId: set.id, item };
  }
  throw new Error("no multiple-choice item in the library");
}

test("before the first sync, reads go to the server; after it, to the store", async () => {
  assert.equal(await sync.hasData(), false);
  assert.equal((await offline.stories()).length, 1, "from the server");
  const s = await sync.sync();
  assert.equal(s.state, "idle");
  assert.equal(await sync.hasData(), true);
  net.online = false;
  try {
    const stories = await offline.stories();
    assert.deepEqual(stories.map((x) => x.id), [EXAMPLE_STORY.id]);
    assert.ok(stories[0]!.words > 0, "word count from the feed");
    assert.equal((await offline.story(EXAMPLE_STORY.id)).story.title, EXAMPLE_STORY.title);
    assert.ok((await offline.exercises()).length > 0, "the library");
    assert.equal(typeof (await offline.progress()).dailyGoal, "number", "the server's stats");
  } finally {
    net.online = true;
  }
});

test("offline practice: a provisional verdict, queued, counted once after reconnecting", async () => {
  const { setId, item } = await mcItem();
  const before = (await server.progress()).totalAnswered;
  net.online = false;
  const right = await offline.answer({ setId, itemId: item.id, response: { type: "multiple_choice", choice: item.answerIndex } });
  assert.deepEqual(right, { correct: true, grading: "auto" });
  await offline.saveExerciseProgress(setId, { index: 1 });
  const resume = await offline.exerciseProgress(setId);
  assert.equal(resume?.index, 1, "resumable offline");
  assert.equal(resume?.results[item.id], true);
  assert.equal(sync.status().pending, 2);
  assert.equal((await sync.sync()).state, "offline");

  net.online = true;
  const s = await sync.sync();
  assert.equal(s.state, "idle");
  assert.equal(s.pending, 0);
  assert.equal((await server.progress()).totalAnswered, before + 1);
  assert.equal((await server.exerciseProgress(setId))?.index, 1);
});

test("a push whose response is lost is sent again and still counts once", async () => {
  const { setId, item } = await mcItem();
  const before = (await server.progress()).totalAnswered;
  net.online = false;
  await offline.answer({ setId, itemId: item.id, response: { type: "multiple_choice", choice: item.answerIndex } });
  net.online = true;
  net.losePushResponse = true;
  assert.equal((await sync.sync()).state, "offline", "the app never heard back");
  assert.equal(sync.status().pending, 1, "so it's still queued");
  assert.equal((await server.progress()).totalAnswered, before + 1, "but the server applied it");
  const s = await sync.sync();
  assert.equal(s.pending, 0);
  assert.equal((await server.progress()).totalAnswered, before + 1, "the replay was a duplicate");
});

test("online with nothing queued, actions go straight to the server", async () => {
  const { setId, item } = await mcItem();
  const before = (await server.progress()).totalAnswered;
  await offline.answer({ setId, itemId: item.id, response: { type: "multiple_choice", choice: item.answerIndex } });
  assert.equal(sync.status().pending, 0);
  assert.equal((await server.progress()).totalAnswered, before + 1);
  await offline.finishRun(setId, true);
  assert.equal(await server.exerciseProgress(setId), null, "finished: the session is gone");
  assert.equal(await offline.exerciseProgress(setId), null, "and gone locally");
});

test("reading offline: progress only forward, read and read again in order", async () => {
  const id = EXAMPLE_STORY.id;
  net.online = false;
  await offline.storyProgress(id, 0.5);
  await offline.storyProgress(id, 0.3);
  assert.equal((await offline.story(id)).progress, 0.5, "never backwards");
  await offline.markStoryRead(id);
  assert.equal((await offline.story(id)).status, "read", "the learner's explicit action shows at once");
  net.online = true;
  await sync.sync();
  const s = await server.story(id);
  assert.equal(s.status, "read");
  assert.ok(s.progress >= 0.5);

  net.online = false;
  await offline.readStoryAgain(id);
  assert.equal((await offline.story(id)).progress, 0);
  net.online = true;
  await sync.sync();
  assert.equal((await server.story(id)).status, "unread");
});

test("vocab offline: save, study, remove", async () => {
  net.online = false;
  const e = await offline.vocabSave({ word: "der Hund", translation: "the dog", examples: [] });
  assert.equal(e.word, "der hund", "keyed as the server keys it");
  assert.equal(e.display, "der Hund");
  assert.equal((await offline.studyVocab("der Hund", true)).known, 1);
  await offline.vocabSave({ word: "die Katze", translation: "the cat", examples: [] });
  await offline.vocabRemove("die Katze");
  assert.deepEqual((await offline.vocab()).map((v) => v.word), ["der hund"]);
  net.online = true;
  await sync.sync();
  const words = await server.vocab();
  assert.deepEqual(words.map((v) => v.word), ["der hund"]);
  assert.deepEqual((await offline.vocab()).map((v) => v.word), ["der hund"], "one entry locally after the pull");
  assert.equal(words[0]!.stats?.known, 1);
});

test("a note made and edited offline reaches the server once, with the edits", async () => {
  net.online = false;
  const n = await offline.createNote({ title: "Offline" });
  assert.ok(n.id.startsWith("local-"));
  await offline.saveNote(n.id, { body: "first" });
  await offline.saveNote(n.id, { body: "first and second" });
  assert.equal(sync.status().pending, 1, "edits folded into the create");
  net.online = true;
  await sync.sync();
  const notes = (await server.notes()).filter((x) => x.title === "Offline");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.body, "first and second");
  assert.equal((await offline.notes()).filter((x) => x.title === "Offline").length, 1, "the local copy was replaced");
  // An editor still holding the local id keeps working.
  const again = await offline.saveNote(n.id, { body: "third" });
  assert.equal(again.id, notes[0]!.id);
  assert.equal((await server.note(notes[0]!.id))?.body, "third");
});

test("a note made and deleted offline never reaches the server", async () => {
  const count = (await server.notes()).length;
  net.online = false;
  const n = await offline.createNote({ title: "Gone" });
  await offline.saveNote(n.id, { body: "x" });
  await offline.removeNote(n.id);
  assert.equal(sync.status().pending, 0);
  net.online = true;
  await sync.sync();
  assert.equal((await server.notes()).length, count);
});

test("a note edited offline and on the web: the app's edit becomes a copy", async () => {
  const n = await server.createNote({ title: "Shared", body: "v1" });
  await sync.sync();
  net.online = false;
  await offline.saveNote(n.id, { body: "from the app" });
  await offline.saveNote(n.id, { body: "from the app, twice" });
  assert.equal(sync.status().pending, 1, "one queued edit, from the same base");
  // The web edits it meanwhile (a second later, so the versions differ).
  await new Promise((r) => setTimeout(r, 1100));
  net.online = true;
  await server.saveNote(n.id, { body: "from the web" });
  net.online = false;
  net.online = true;
  await sync.sync();
  const shared = (await server.notes()).filter((x) => x.title.startsWith("Shared"));
  assert.equal(shared.length, 2, "the web's version and the app's copy");
  assert.ok(shared.some((x) => x.body === "from the web"));
  assert.ok(shared.some((x) => x.body === "from the app, twice"));
  assert.equal((await offline.notes()).filter((x) => x.title.startsWith("Shared")).length, 2, "both arrive locally");
});

test("deletions elsewhere arrive as tombstones", async () => {
  await server.vocabRemove("der Hund");
  await sync.sync();
  assert.equal(await offline.vocabGet("der Hund"), null);
});
