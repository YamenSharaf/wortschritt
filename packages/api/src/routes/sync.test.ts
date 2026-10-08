import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import { EXAMPLE_SERIES, EXAMPLE_SET, EXAMPLE_STORY } from "@mdb/shared";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-sync-"));
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
type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;
type Client = (method: InjectOptions["method"], url: string, payload?: unknown) => Promise<Res>;
async function login(username: string, password: string): Promise<Client> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  const cookie = `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`;
  return (method, url, payload) =>
    app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
}
let me: Client;
let anna: Client;
before(async () => {
  const { buildApp } = await import("../app");
  app = await buildApp();
  me = await login("yamen", "admin-password");
  await me("PUT", "/api/admin/registration", { open: true });
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "anna", password: "anna-password" } });
  anna = await login("anna", "anna-password");
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

type Changes = {
  cursor: string;
  full: boolean;
  more: boolean;
  library: { version: string; exerciseSets: { id: string }[]; cheatsheets: unknown[]; builtIn: string[] } | null;
  stories: { story: { id: string; title: string }; progress: number; cover: string | null; translations: unknown }[];
  series: { id: string; chapters: { progress: number }[] }[];
  vocab: { word: string; groups: number[] }[];
  groups: { id: number; name: string }[];
  notes: { id: string; title: string; body: string; updatedAt: number }[];
  settings: unknown;
  deleted: Record<"stories" | "series" | "vocab" | "groups" | "notes", string[]>;
};
const changes = async (who: Client, since?: string, library?: string) => {
  const q = new URLSearchParams({ ...(since ? { since } : {}), ...(library ? { library } : {}) });
  const res = await who("GET", `/api/sync/changes?${q}`);
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as Changes;
};
const push = async (who: Client, ops: unknown[]) => {
  const res = await who("POST", "/api/sync/push", { ops });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().results as { opId: string; ok: boolean; duplicate: boolean; error?: string; noteId?: string; conflict?: boolean }[];
};

let cursor = "";
let libraryVersion = "";

test("first sync: a full snapshot with the library", async () => {
  await me("POST", "/api/stories", { story: EXAMPLE_STORY });
  const c = await changes(me);
  assert.equal(c.full, true);
  assert.ok(c.library && c.library.exerciseSets.length > 0 && c.library.builtIn.length > 0);
  assert.deepEqual(c.stories.map((s) => s.story.id), [EXAMPLE_STORY.id]);
  assert.ok(c.stories[0]!.translations, "with its paragraphs for English lines");
  assert.ok(c.settings);
  cursor = c.cursor;
  libraryVersion = c.library!.version;

  const again = await changes(me, cursor, libraryVersion);
  assert.equal(again.full, false);
  assert.equal(again.library, null, "unchanged library isn't resent");
  assert.equal(again.stories.length + again.notes.length + again.vocab.length, 0);
});

test("incremental: changes from any write path, deletions, and books follow their chapters", async () => {
  const note = (await me("POST", "/api/notes", { title: "Wortstellung", body: "Verb an zweiter Stelle" })).json();
  await me("POST", "/api/vocab", { word: "verstecken", translation: "to hide" });
  const group = (await me("POST", "/api/vocab-groups", { name: "Pablo" })).json();
  await me("POST", `/api/vocab-groups/${group.id}/words`, { word: "verstecken" });
  await me("POST", "/api/series", { series: EXAMPLE_SERIES });
  await me("PUT", `/api/series/${EXAMPLE_SERIES.id}/chapters/1`, { story: EXAMPLE_STORY, summary: "s" });
  await me("PUT", `/api/stories/${EXAMPLE_STORY.id}/progress`, { progress: 0.5 });

  const c = await changes(me, cursor, libraryVersion);
  assert.equal(c.full, false);
  assert.deepEqual(c.notes.map((n) => n.id), [note.id]);
  assert.equal(c.vocab[0]?.word, "verstecken");
  assert.deepEqual(c.vocab[0]?.groups, [group.id]);
  assert.deepEqual(c.groups.map((g) => g.name), ["Pablo"]);
  assert.deepEqual(c.stories.map((s) => s.story.id).sort(), [`${EXAMPLE_SERIES.id}-01`, EXAMPLE_STORY.id].sort());
  assert.equal(c.stories.find((s) => s.story.id === EXAMPLE_STORY.id)!.progress, 0.5);
  assert.deepEqual(c.series.map((s) => s.id), [EXAMPLE_SERIES.id]);
  cursor = c.cursor;

  // Reading a chapter changes its book's progress too; a cover change counts.
  await me("PUT", `/api/stories/${EXAMPLE_SERIES.id}-01/progress`, { progress: 1, read: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><rect width="600" height="900" fill="#fff"/></svg>`;
  await me("PUT", `/api/stories/${EXAMPLE_STORY.id}/cover`, { svg });
  const c2 = await changes(me, cursor, libraryVersion);
  assert.ok(c2.series.find((s) => s.id === EXAMPLE_SERIES.id)!.chapters[0]!.progress === 1);
  assert.ok(c2.stories.find((s) => s.story.id === EXAMPLE_STORY.id)!.cover, "cover version");
  cursor = c2.cursor;

  // Deletions show up as ids.
  await me("DELETE", `/api/notes/${note.id}`);
  await me("DELETE", `/api/series/${EXAMPLE_SERIES.id}`);
  await me("DELETE", `/api/vocab-groups/${group.id}`);
  const c3 = await changes(me, cursor, libraryVersion);
  assert.deepEqual(c3.deleted.notes, [note.id]);
  assert.deepEqual(c3.deleted.series, [EXAMPLE_SERIES.id]);
  assert.deepEqual(c3.deleted.stories, [`${EXAMPLE_SERIES.id}-01`]);
  assert.deepEqual(c3.deleted.groups, [String(group.id)]);
  assert.deepEqual(c3.vocab.map((v) => [v.word, v.groups]), [["verstecken", []]], "the word left the group");
  cursor = c3.cursor;
});

test("the library is resent when it changes", async () => {
  await me("POST", "/api/import", { kind: "exercise", data: { ...EXAMPLE_SET, id: "sync-test-set" } });
  const c = await changes(me, cursor, libraryVersion);
  assert.ok(c.library?.exerciseSets.some((s) => s.id === "sync-test-set"));
  assert.notEqual(c.library!.version, libraryVersion);
});

test("push: applied once per op id; progress only moves forward; answers are recorded", async () => {
  await me("PUT", `/api/stories/${EXAMPLE_STORY.id}/progress`, { progress: 0.6 });
  const r1 = await push(me, [
    { opId: "op-progress-1", type: "storyProgress", storyId: EXAMPLE_STORY.id, progress: 0.3 },
    { opId: "op-attempt-1", type: "attempt", data: { setId: "sync-test-set", itemId: EXAMPLE_SET.items![0]!.id, correct: true } },
  ]);
  assert.deepEqual(r1.map((r) => [r.ok, r.duplicate]), [[true, false], [true, false]]);
  assert.equal((await me("GET", `/api/stories/${EXAMPLE_STORY.id}`)).json().progress, 0.6, "the further position wins");

  const before = (await me("GET", "/api/progress")).json();
  const r2 = await push(me, [{ opId: "op-attempt-1", type: "attempt", data: { setId: "sync-test-set", itemId: EXAMPLE_SET.items![0]!.id, correct: true } }]);
  assert.deepEqual(r2.map((r) => [r.ok, r.duplicate]), [[true, true]]);
  assert.deepEqual((await me("GET", "/api/progress")).json(), before, "a replay isn't counted twice");

  await push(me, [{ opId: "op-progress-2", type: "storyProgress", storyId: EXAMPLE_STORY.id, progress: 0.9, read: true }]);
  const story = (await me("GET", `/api/stories/${EXAMPLE_STORY.id}`)).json();
  assert.equal(story.progress, 0.9);
  assert.ok(story.readAt);

  await push(me, [
    { opId: "op-vocab-1", type: "vocabSave", data: { word: "plötzlich", translation: "suddenly" } },
    { opId: "op-vocab-2", type: "vocabStudy", word: "plötzlich", known: true },
    { opId: "op-vocab-3", type: "vocabStudy", word: "nichtda", known: true },
  ]).then((r) => assert.deepEqual(r.map((x) => x.ok), [true, true, false]));
});

test("push: note edits from two devices keep both versions", async () => {
  const [created] = await push(me, [{ opId: "op-note-1", type: "noteCreate", data: { title: "Als/Wenn", body: "v1" } }]);
  const id = created!.noteId!;
  const base = (await me("GET", `/api/notes/${id}`)).json().updatedAt as number;

  const [ok] = await push(me, [{ opId: "op-note-2", type: "noteUpdate", id, baseUpdatedAt: base, data: { body: "v2 from the phone" } }]);
  assert.equal(ok!.conflict, undefined);
  assert.equal((await me("GET", `/api/notes/${id}`)).json().body, "v2 from the phone");

  // Edited on the web in the meantime (a later updatedAt): the app's version becomes a copy.
  await new Promise((r) => setTimeout(r, 1100));
  await me("PUT", `/api/notes/${id}`, { body: "v3 from the web" });
  const [conflict] = await push(me, [{ opId: "op-note-3", type: "noteUpdate", id, baseUpdatedAt: base, data: { body: "v3 from the phone" } }]);
  assert.equal(conflict!.conflict, true);
  assert.equal((await me("GET", `/api/notes/${id}`)).json().body, "v3 from the web");
  const copy = (await me("GET", `/api/notes/${conflict!.noteId}`)).json();
  assert.equal(copy.body, "v3 from the phone");
  assert.match(copy.title, /conflict copy/);

  // Deleted elsewhere: the app's text comes back as a new note.
  await me("DELETE", `/api/notes/${id}`);
  const [revived] = await push(me, [{ opId: "op-note-4", type: "noteUpdate", id, baseUpdatedAt: base, data: { title: "Als/Wenn", body: "still mine" } }]);
  assert.equal((await me("GET", `/api/notes/${revived!.noteId}`)).json().body, "still mine");
});

test("private: another user's sync and pushes never touch your data", async () => {
  const c = await changes(anna);
  assert.equal(c.stories.length + c.notes.length + c.vocab.length + c.series.length, 0);
  const myNote = (await me("POST", "/api/notes", { title: "Privat", body: "x" })).json();
  const later = await changes(anna, c.cursor, c.library!.version);
  assert.equal(later.notes.length + later.deleted.notes.length, 0, "my changes aren't in Anna's log");

  const r = await push(anna, [
    { opId: "anna-op-1", type: "storyProgress", storyId: EXAMPLE_STORY.id, progress: 0.1 },
    { opId: "anna-op-2", type: "noteDelete", id: myNote.id },
    { opId: "anna-op-3", type: "noteUpdate", id: myNote.id, baseUpdatedAt: 0, data: { body: "hacked" } },
  ]);
  assert.equal(r[0]!.ok, false);
  assert.equal((await me("GET", `/api/notes/${myNote.id}`)).json().body, "x", "not deleted or changed");
  // Op ids are per user: the same id from me is a new op.
  const mine = await push(me, [{ opId: "anna-op-1", type: "storyProgress", storyId: EXAMPLE_STORY.id, progress: 0.95 }]);
  assert.equal(mine[0]!.duplicate, false);
});

test("a cursor older than the kept log gets a full snapshot", async () => {
  const { db, schema } = await import("../db/client");
  db.insert(schema.appSettings).values({ key: "sync.horizon", value: "999999999" }).onConflictDoUpdate({ target: schema.appSettings.key, set: { value: "999999999" } }).run();
  assert.equal((await changes(me, cursor, libraryVersion)).full, true);
  db.insert(schema.appSettings).values({ key: "sync.horizon", value: "0" }).onConflictDoUpdate({ target: schema.appSettings.key, set: { value: "0" } }).run();
});
