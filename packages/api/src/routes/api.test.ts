import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-api-"));
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

let ip = 0;
type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;
const call = (headers: Record<string, string>) =>
  (method: InjectOptions["method"], url: string, payload?: unknown): Promise<Res> =>
    app.inject({
      method,
      url,
      headers: { ...headers, "cf-connecting-ip": `192.0.2.${++ip}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

async function session(username: string, password: string) {
  const res = await call({})("POST", "/api/auth/login", { username, password });
  assert.equal(res.statusCode, 200, res.body);
  return call({ cookie: `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}` });
}
const bearer = (token: string) => call({ authorization: `Bearer ${token}` });

let admin: ReturnType<typeof call>;
let adminToken: string;
let anna: ReturnType<typeof call>;
let annaApi: ReturnType<typeof call>;

test("a token is created in the app, shown once, and listed without its secret", async () => {
  admin = await session("yamen", "admin-password");
  const res = await admin("POST", "/api/auth/tokens", { name: "MCP server" });
  assert.equal(res.statusCode, 200, res.body);
  const { token, tokens } = res.json() as { token: string; tokens: { name: string; prefix: string; lastUsedAt: null }[] };
  assert.match(token, /^mdb_[A-Za-z0-9_-]{43}$/);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.name, "MCP server");
  assert.ok(token.startsWith(tokens[0]!.prefix));
  assert.ok(!(await admin("GET", "/api/auth/tokens")).body.includes(token), "never listed again");
  adminToken = token;

  const { db, schema } = await import("../db/client");
  assert.ok(!JSON.stringify(db.select().from(schema.apiTokens).all()).includes(token), "stored hashed");
});

test("Bearer token: who am I, and lastUsedAt is recorded", async () => {
  const api = bearer(adminToken);
  assert.deepEqual((await api("GET", "/api/auth/me")).json(), {
    authenticated: true,
    user: { username: "yamen", role: "admin" },
  });
  await api("GET", "/api/notes");
  const [t] = (await admin("GET", "/api/auth/tokens")).json() as { lastUsedAt: number | null }[];
  assert.ok(t!.lastUsedAt);
});

test("Bearer token: full CRUD on notes and vocab", async () => {
  const api = bearer(adminToken);
  const note = (await api("POST", "/api/notes", { title: "Dativ", body: "mit + Dativ" })).json();
  assert.equal((await api("GET", `/api/notes/${note.id}`)).json().title, "Dativ");
  assert.equal((await api("PUT", `/api/notes/${note.id}`, { body: "aus, bei, mit" })).json().body, "aus, bei, mit");
  await api("DELETE", `/api/notes/${note.id}`);
  assert.equal((await api("GET", `/api/notes/${note.id}`)).json(), null);

  await api("POST", "/api/vocab", { word: "Haus", display: "das Haus", translation: "house" });
  const group = (await api("POST", "/api/vocab-groups", { name: "Wohnen" })).json();
  await api("POST", `/api/vocab-groups/${group.id}/words`, { word: "haus" });
  const entry = (await api("GET", "/api/vocab/haus")).json();
  assert.equal(entry.translation, "house");
  assert.deepEqual(entry.groups, [group.id]);
  await api("DELETE", "/api/vocab/haus");
  assert.equal((await api("GET", "/api/vocab/haus")).json(), null);
});

const exerciseSet = (id: string) => {
  const data = JSON.parse(readFileSync(join(contentDir, "exercises", "als-oder-wenn.json"), "utf8"));
  return { kind: "exercise", data: { ...data, id, title: `Set ${id}` } };
};

test("Bearer token: import, list and delete exercise sets", async () => {
  const api = bearer(adminToken);
  assert.equal((await api("POST", "/api/import", exerciseSet("api-set"))).statusCode, 200);
  assert.ok(((await api("GET", "/api/exercises")).json() as { id: string }[]).some((s) => s.id === "api-set"));
  const list = (await api("GET", "/api/imports")).json() as { id: string; createdAt: string }[];
  const item = list.find((i) => i.id === "api-set")!;
  assert.deepEqual(item, {
    id: "api-set", kind: "exercise", title: "Set api-set", createdAt: item.createdAt,
    createdBy: "yamen", canDelete: true,
  });
  assert.equal((await api("DELETE", "/api/imports/api-set")).statusCode, 200);
  assert.ok(!((await api("GET", "/api/exercises")).json() as { id: string }[]).some((s) => s.id === "api-set"));
  assert.equal((await api("DELETE", "/api/imports/als-oder-wenn")).statusCode, 404, "built-in files can't be deleted");
});

test("deleting imports: the importer or an admin, nobody else", async () => {
  await admin("PUT", "/api/admin/registration", { open: true });
  for (const name of ["anna", "ben"]) {
    const res = await call({})("POST", "/api/auth/register", { username: name, password: `${name}-password` });
    assert.equal(res.statusCode, 200);
  }
  anna = await session("anna", "anna-password");
  const ben = await session("ben", "ben-password");
  annaApi = bearer((await anna("POST", "/api/auth/tokens", { name: "script" })).json().token);

  await annaApi("POST", "/api/import", exerciseSet("anna-set"));
  await bearer(adminToken)("POST", "/api/import", exerciseSet("admin-set"));
  const seen = (await ben("GET", "/api/imports")).json() as { id: string; canDelete: boolean }[];
  assert.ok(seen.every((i) => !i.canDelete), "ben owns none");

  assert.equal((await ben("DELETE", "/api/imports/anna-set")).statusCode, 403);
  assert.equal((await annaApi("DELETE", "/api/imports/admin-set")).statusCode, 403);
  assert.equal((await annaApi("DELETE", "/api/imports/anna-set")).statusCode, 200);
  assert.equal((await admin("DELETE", "/api/imports/admin-set")).statusCode, 200);
});

test("a token only sees its own user's data", async () => {
  const note = (await bearer(adminToken)("POST", "/api/notes", { title: "privat" })).json();
  assert.deepEqual((await annaApi("GET", "/api/notes")).json(), []);
  assert.equal((await annaApi("GET", `/api/notes/${note.id}`)).json(), null);
  assert.equal((await annaApi("PUT", `/api/notes/${note.id}`, { title: "x" })).statusCode, 404);
  // …and a regular user's token has no admin rights.
  assert.equal((await annaApi("GET", "/api/admin/users")).statusCode, 403);
});

test("a token can't manage tokens or change the password", async () => {
  const api = bearer(adminToken);
  assert.equal((await api("GET", "/api/auth/tokens")).statusCode, 403);
  assert.equal((await api("POST", "/api/auth/tokens", { name: "x" })).statusCode, 403);
  assert.equal((await api("DELETE", "/api/auth/tokens/1")).statusCode, 403);
  assert.equal(
    (await api("POST", "/api/auth/password", { currentPassword: "admin-password", newPassword: "something-else-1" })).statusCode,
    403,
  );
});

test("a wrong or malformed Bearer is refused, even next to a valid cookie", async () => {
  for (const auth of ["Bearer mdb_not-a-real-token", "Bearer something", "Basic eWFtZW46eA==", "Bearer"]) {
    assert.equal((await call({ authorization: auth })("GET", "/api/notes")).statusCode, 401, auth);
  }
  const loginRes = await call({})("POST", "/api/auth/login", { username: "yamen", password: "admin-password" });
  const cookie = `mdb_session=${loginRes.cookies.find((c) => c.name === "mdb_session")!.value}`;
  const both = call({ cookie, authorization: "Bearer mdb_wrong" });
  assert.equal((await both("GET", "/api/notes")).statusCode, 401, "no fallback to the cookie");
});

test("revoked, disabled and deleted: the token stops working", async () => {
  // Revoked.
  const created = (await anna("POST", "/api/auth/tokens", { name: "temp" })).json();
  const temp = bearer(created.token);
  assert.equal((await temp("GET", "/api/notes")).statusCode, 200);
  const id = (created.tokens as { id: number; name: string }[]).find((t) => t.name === "temp")!.id;
  await anna("DELETE", `/api/auth/tokens/${id}`);
  assert.equal((await temp("GET", "/api/notes")).statusCode, 401);

  // Disabled, then enabled again.
  const users = (await admin("GET", "/api/admin/users")).json() as { id: number; username: string }[];
  const annaId = users.find((u) => u.username === "anna")!.id;
  await admin("PATCH", `/api/admin/users/${annaId}`, { disabled: true });
  assert.equal((await annaApi("GET", "/api/notes")).statusCode, 401);
  await admin("PATCH", `/api/admin/users/${annaId}`, { disabled: false });
  assert.equal((await annaApi("GET", "/api/notes")).statusCode, 200);

  // Deleted.
  await admin("DELETE", `/api/admin/users/${annaId}`);
  assert.equal((await annaApi("GET", "/api/notes")).statusCode, 401);
});

test("at most 10 tokens per user", async () => {
  for (let i = 1; i < 10; i++) {
    assert.equal((await admin("POST", "/api/auth/tokens", { name: `t${i}` })).statusCode, 200);
  }
  const res = await admin("POST", "/api/auth/tokens", { name: "one too many" });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /at most 10/);
});

test("API docs need a session or a token; the spec documents Bearer auth", async () => {
  assert.equal((await call({})("GET", "/api/docs/json")).statusCode, 401);
  assert.equal((await call({})("GET", "/api/docs/")).statusCode, 401);
  assert.equal((await admin("GET", "/api/docs/")).statusCode, 200);
  const spec = (await bearer(adminToken)("GET", "/api/docs/json")).json();
  assert.deepEqual(spec.components.securitySchemes.bearer, { type: "http", scheme: "bearer" });
  assert.ok(spec.paths["/api/notes"], "routes are documented");
  assert.ok(spec.paths["/api/imports/{id}"]);
});
