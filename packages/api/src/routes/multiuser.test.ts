import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-multiuser-"));
const contentDir = resolve(import.meta.dirname, "../../../../content");
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: contentDir,
  NODE_ENV: "test",
  TTS_URL: "",
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

let ipCounter = 0;
const newIp = () => `198.51.100.${++ipCounter}`;

/** A signed-in client: `call(method, url, payload?)` with its cookie. */
type Client = ReturnType<typeof client>;
function client(cookie: string) {
  return (method: InjectOptions["method"], url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { cookie, "cf-connecting-ip": newIp() },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
}
function cookieOf(res: Awaited<ReturnType<FastifyInstance["inject"]>>): string {
  const c = res.cookies.find((c) => c.name === "mdb_session");
  assert.ok(c, `no session cookie (status ${res.statusCode}: ${res.body})`);
  return `mdb_session=${c.value}`;
}
async function login(username: string, password: string): Promise<Client> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "cf-connecting-ip": newIp() },
    payload: { username, password },
  });
  assert.equal(res.statusCode, 200, res.body);
  return client(cookieOf(res));
}
const register = (username: string, password: string) =>
  app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "cf-connecting-ip": newIp() },
    payload: { username, password },
  });

/** A valid exercise set (a built-in one) under a new id. */
function exerciseSet(id: string) {
  const data = JSON.parse(
    readFileSync(join(contentDir, "exercises", "als-oder-wenn.json"), "utf8"),
  );
  return { kind: "exercise", data: { ...data, id } };
}

let admin: Client;
let anna: Client;
let ben: Client;

test("registration is closed by default and only the admin can open it", async () => {
  admin = await login("yamen", "admin-password");
  const status = await app.inject({ method: "GET", url: "/api/auth/registration" });
  assert.deepEqual(status.json(), { open: false, openUntil: null });
  assert.equal((await register("anna", "anna-password")).statusCode, 403);

  const opened = (await admin("PUT", "/api/admin/registration", { open: true })).json();
  assert.equal(opened.open, true);
  const hours = (opened.openUntil - Date.now() / 1000) / 3600;
  assert.ok(hours > 23.9 && hours <= 24, `closes in ~24h, got ${hours}`);
});

test("registration validates input and refuses taken usernames", async () => {
  const res = await register("anna", "anna-password");
  assert.equal(res.statusCode, 200, res.body);
  anna = client(cookieOf(res));
  assert.deepEqual((await anna("GET", "/api/auth/me")).json(), {
    authenticated: true,
    user: { username: "anna", role: "user" },
  });

  assert.equal((await register("ANNA", "another-password")).statusCode, 409);
  assert.equal((await register("Yamen", "another-password")).statusCode, 409);
  assert.equal((await register("ben", "short")).statusCode, 400);
  assert.equal((await register("b", "long-enough-pass")).statusCode, 400);
  assert.equal((await register("ben smith", "long-enough-pass")).statusCode, 400);

  const benRes = await register("ben", "ben-password");
  assert.equal(benRes.statusCode, 200);
  ben = client(cookieOf(benRes));
});

test("registration closes on request and on its own after the window", async () => {
  await admin("PUT", "/api/admin/registration", { open: false });
  assert.equal((await register("carl", "carl-password")).statusCode, 403);

  // Open, then pretend the 24h window has passed.
  await admin("PUT", "/api/admin/registration", { open: true });
  const { db, schema } = await import("../db/client");
  db.update(schema.appSettings)
    .set({ value: String(Math.floor(Date.now() / 1000) - 1) })
    .run();
  assert.equal((await register("carl", "carl-password")).statusCode, 403);
  assert.equal((await admin("GET", "/api/admin/registration")).json().open, false);
});

test("admin routes are admin-only", async () => {
  for (const [method, url, body] of [
    ["GET", "/api/admin/users"],
    ["PUT", "/api/admin/registration", { open: true }],
    ["PATCH", "/api/admin/users/1", { role: "user" }],
    ["DELETE", "/api/admin/users/1"],
    ["POST", "/api/admin/users/1/password", { password: "hijacked-password" }],
  ] as const) {
    assert.equal((await anna(method, url, body)).statusCode, 403, `${method} ${url}`);
  }
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/admin/users" })).statusCode,
    401,
  );
  // Voice downloads write to the server for everyone: admin-only too.
  assert.equal(
    (await anna("POST", "/api/tts/download", { voice: "x" })).statusCode,
    403,
  );
});

test("learner data is private: another user can't read or change it", async () => {
  // yamen's data
  await admin("POST", "/api/vocab", { word: "Haus", display: "das Haus", translation: "house" });
  await admin("POST", "/api/vocab/haus/study", { known: true });
  const group = (await admin("POST", "/api/vocab-groups", { name: "Wohnen" })).json();
  await admin("POST", `/api/vocab-groups/${group.id}/words`, { word: "haus" });
  const note = (await admin("POST", "/api/notes", { title: "Dativ", body: "mit + Dativ" })).json();
  await admin("POST", "/api/attempts", { setId: "perfekt-bilden", itemId: "p1", correct: true });
  await admin("POST", "/api/runs", {
    setId: "perfekt-bilden", setTitle: "Perfekt", total: 1, answered: 1, correct: 1,
    results: { p1: true },
  });
  await admin("POST", "/api/sheet-views", { sheetId: "perfekt", title: "Perfekt" });
  await admin("PUT", "/api/exercise-progress/perfekt-bilden", { index: 3, results: {} });
  const settings = (await admin("GET", "/api/settings")).json();
  await admin("PUT", "/api/settings", { ...settings, displayName: "Yamen" });

  // anna sees none of it…
  assert.deepEqual((await anna("GET", "/api/vocab")).json(), []);
  assert.equal((await anna("GET", "/api/vocab/haus")).json(), null);
  assert.deepEqual((await anna("GET", "/api/vocab-groups")).json(), []);
  assert.deepEqual((await anna("GET", "/api/notes")).json(), []);
  assert.equal((await anna("GET", `/api/notes/${note.id}`)).json(), null);
  assert.equal((await anna("GET", "/api/progress")).json().totalAnswered, 0);
  assert.deepEqual((await anna("GET", "/api/runs")).json(), []);
  assert.equal((await anna("GET", "/api/runs/perfekt-bilden")).json(), null);
  assert.deepEqual((await anna("GET", "/api/sheet-views")).json(), []);
  assert.equal((await anna("GET", "/api/exercise-progress/perfekt-bilden")).json(), null);
  assert.equal((await anna("GET", "/api/settings")).json().displayName, "Learner");

  // …and can't change it, even knowing the ids.
  assert.equal(
    (await anna("PUT", `/api/notes/${note.id}`, { title: "pwned" })).statusCode,
    404,
  );
  await anna("DELETE", `/api/notes/${note.id}`);
  await anna("DELETE", "/api/vocab/haus");
  await anna("DELETE", "/api/vocab/haus/study");
  await anna("POST", `/api/vocab-groups/${group.id}/words`, { word: "katze" });
  await anna("DELETE", `/api/vocab-groups/${group.id}/words/haus`);
  await anna("DELETE", `/api/vocab-groups/${group.id}`);
  await anna("DELETE", "/api/exercise-progress/perfekt-bilden");
  // The same word saved by anna is her own copy.
  await anna("POST", "/api/vocab", { word: "haus", translation: "home (anna)" });
  await anna("POST", "/api/vocab/haus/study", { known: false });

  const mine = (await admin("GET", "/api/vocab/haus")).json();
  assert.equal(mine.translation, "house");
  assert.deepEqual(mine.groups, [group.id]);
  assert.equal(mine.stats.known, 1);
  assert.equal(mine.stats.missed, 0);
  const groups = (await admin("GET", "/api/vocab-groups")).json();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 1, "anna's 'katze' didn't land in yamen's group");
  assert.equal((await admin("GET", `/api/notes/${note.id}`)).json().title, "Dativ");
  assert.equal((await admin("GET", "/api/progress")).json().totalAnswered, 1);
  assert.equal((await admin("GET", "/api/exercise-progress/perfekt-bilden")).json().index, 3);
  assert.equal((await admin("GET", "/api/settings")).json().displayName, "Yamen");
  assert.equal((await anna("GET", "/api/vocab/haus")).json().translation, "home (anna)");
});

test("stories are private: another user can't read, change or delete them", async () => {
  const { EXAMPLE_STORY } = await import("@mdb/shared");
  assert.equal((await admin("POST", "/api/stories", { story: EXAMPLE_STORY })).statusCode, 200);
  const id = EXAMPLE_STORY.id;

  assert.deepEqual((await anna("GET", "/api/stories")).json(), []);
  assert.equal((await anna("GET", `/api/stories/${id}`)).statusCode, 404);
  assert.equal((await anna("PUT", `/api/stories/${id}`, { ...EXAMPLE_STORY, title: "pwned" })).statusCode, 404);
  assert.equal((await anna("PUT", `/api/stories/${id}/progress`, { progress: 1, read: true })).statusCode, 404);
  assert.equal((await anna("DELETE", `/api/stories/${id}`)).statusCode, 404);
  assert.equal((await anna("GET", `/api/stories/${id}/translations`)).statusCode, 404);
  assert.equal(
    (await anna("PUT", `/api/stories/${id}/translations`, { paragraphs: [{ index: 0, lines: ["pwned"] }] })).statusCode,
    404,
  );

  // The same id is anna's own story.
  assert.equal((await anna("POST", "/api/stories", { story: { ...EXAMPLE_STORY, title: "Annas Version" } })).statusCode, 200);
  const mine = (await admin("GET", `/api/stories/${id}`)).json();
  assert.equal(mine.story.title, EXAMPLE_STORY.title);
  assert.equal(mine.readAt, null);
  assert.equal((await anna("GET", `/api/stories/${id}`)).json().story.title, "Annas Version");
});

test("shared library: imports are visible to all, editable only by their owner", async () => {
  assert.equal((await anna("POST", "/api/import", exerciseSet("anna-set"))).statusCode, 200);
  const benSees = (await ben("GET", "/api/exercises")).json() as { id: string }[];
  assert.ok(benSees.some((s) => s.id === "anna-set"), "shared with everyone");

  assert.equal((await anna("POST", "/api/import", exerciseSet("anna-set"))).statusCode, 200);
  assert.equal((await ben("POST", "/api/import", exerciseSet("anna-set"))).statusCode, 403);
  assert.equal((await admin("POST", "/api/import", exerciseSet("anna-set"))).statusCode, 200);
  // Built-in ids are reserved for the admin.
  assert.equal((await ben("POST", "/api/import", exerciseSet("als-oder-wenn"))).statusCode, 409);
  assert.equal((await admin("POST", "/api/import", exerciseSet("als-oder-wenn"))).statusCode, 200);
});

test("an old import that fails a newer, stricter schema is skipped, not fatal", async () => {
  const { db, schema } = await import("../db/client");
  const broken = exerciseSet("old-import").data;
  // Duplicate item ids: accepted before that rule existed.
  broken.items = [broken.items[0], broken.items[0]];
  db.insert(schema.importedContent)
    .values({ id: "old-import", kind: "exercise", data: broken })
    .run();
  const res = await ben("GET", "/api/exercises");
  assert.equal(res.statusCode, 200);
  const ids = (res.json() as { id: string }[]).map((s) => s.id);
  assert.ok(!ids.includes("old-import"));
  assert.ok(ids.includes("anna-set"), "other imports still listed");
});

test("admin: disable signs a user out; the last admin is protected", async () => {
  const users = (await admin("GET", "/api/admin/users")).json() as {
    id: number; username: string; role: string; lastLoginAt: number | null;
  }[];
  assert.deepEqual(users.map((u) => u.username), ["yamen", "anna", "ben"]);
  assert.ok(users.every((u) => u.lastLoginAt));
  const annaId = users.find((u) => u.username === "anna")!.id;
  const yamenId = users.find((u) => u.username === "yamen")!.id;

  assert.equal((await admin("PATCH", `/api/admin/users/${annaId}`, { disabled: true })).statusCode, 200);
  assert.equal((await anna("GET", "/api/vocab")).statusCode, 401, "signed out");
  const blocked = await app.inject({
    method: "POST", url: "/api/auth/login", headers: { "cf-connecting-ip": newIp() },
    payload: { username: "anna", password: "anna-password" },
  });
  assert.equal(blocked.statusCode, 401);
  await admin("PATCH", `/api/admin/users/${annaId}`, { disabled: false });
  anna = await login("anna", "anna-password");

  for (const [method, url, body] of [
    ["PATCH", `/api/admin/users/${yamenId}`, { role: "user" }],
    ["PATCH", `/api/admin/users/${yamenId}`, { disabled: true }],
    ["DELETE", `/api/admin/users/${yamenId}`],
  ] as const) {
    assert.equal((await admin(method, url, body)).statusCode, 400, `${method} ${url}`);
  }
  assert.equal((await admin("DELETE", "/api/admin/users/9999")).statusCode, 404);
});

test("admin: last login survives logout", async () => {
  await ben("POST", "/api/auth/logout");
  const users = (await admin("GET", "/api/admin/users")).json() as {
    username: string; lastLoginAt: number | null;
  }[];
  assert.ok(users.find((u) => u.username === "ben")!.lastLoginAt);
  ben = await login("ben", "ben-password");
});

test("admin: temporary password ends the user's sessions", async () => {
  const users = (await admin("GET", "/api/admin/users")).json() as { id: number; username: string }[];
  const benId = users.find((u) => u.username === "ben")!.id;
  const res = await admin("POST", `/api/admin/users/${benId}/password`, {
    password: "temporary-password",
  });
  assert.equal(res.statusCode, 200);
  assert.equal((await ben("GET", "/api/vocab")).statusCode, 401);
  ben = await login("ben", "temporary-password");
});

test("admin: deleting a user deletes their data but keeps their imports", async () => {
  const users = (await admin("GET", "/api/admin/users")).json() as { id: number; username: string }[];
  const annaId = users.find((u) => u.username === "anna")!.id;
  assert.equal((await admin("DELETE", `/api/admin/users/${annaId}`)).statusCode, 200);
  assert.equal((await anna("GET", "/api/vocab")).statusCode, 401);

  const { db, schema } = await import("../db/client");
  const { eq } = await import("drizzle-orm");
  assert.equal(db.select().from(schema.vocab).where(eq(schema.vocab.userId, annaId)).all().length, 0);
  assert.equal(db.select().from(schema.vocabStats).where(eq(schema.vocabStats.userId, annaId)).all().length, 0);
  assert.equal(db.select().from(schema.stories).where(eq(schema.stories.userId, annaId)).all().length, 0);
  const sets = (await ben("GET", "/api/exercises")).json() as { id: string }[];
  assert.ok(sets.some((s) => s.id === "anna-set"), "anna's import stays in the library");
  // yamen's data is untouched.
  assert.equal((await admin("GET", "/api/vocab/haus")).json().translation, "house");
});
