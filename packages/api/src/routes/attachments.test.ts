import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-attachments-"));
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
type Client = (method: InjectOptions["method"], url: string, payload?: unknown, headers?: Record<string, string>) => Promise<Res>;
async function login(username: string, password: string): Promise<Client> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  const cookie = `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`;
  return (method, url, payload, headers = {}) =>
    app.inject({ method, url, headers: { cookie, ...headers }, ...(payload === undefined ? {} : { payload: payload as string }) });
}
let me: Client;
let anna: Client;
before(async () => {
  const { buildApp } = await import("../app");
  app = await buildApp();
  me = await login("yamen", "admin-password");
  await me("PUT", "/api/admin/registration", { open: true });
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "anna", password: "anna-password" } });
  assert.equal(res.statusCode, 200, res.body);
  anna = await login("anna", "anna-password");
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const upload = (who: Client, noteId: string, name: string, data: string | Buffer, type: string) =>
  who("POST", `/api/notes/${noteId}/attachments?name=${encodeURIComponent(name)}`, data, { "content-type": type });

test("upload, list with the note, serve (with ranges), delete", async () => {
  const note = (await me("POST", "/api/notes", { title: "Kurs" })).json();
  const text = "[11:30] Speaker 1: Grüß Gott\n";
  const up = await upload(me, note.id, "Transkript.txt", text, "text/plain");
  assert.equal(up.statusCode, 200, up.body);
  const a = up.json();
  assert.equal(a.name, "Transkript.txt");
  assert.equal(a.type, "text/plain");
  assert.equal(a.size, Buffer.byteLength(text));

  // JSON is taken as a file too, not parsed.
  const json = await upload(me, note.id, "../../daten.json", '{"a":1}', "application/json; charset=utf-8");
  assert.equal(json.statusCode, 200, json.body);
  assert.equal(json.json().name, "daten.json", "no path in the name");
  assert.equal(json.json().type, "application/json");

  const got = (await me("GET", `/api/notes/${note.id}`)).json();
  assert.deepEqual(got.attachments.map((x: { name: string }) => x.name), ["Transkript.txt", "daten.json"]);
  assert.equal((await me("GET", "/api/notes")).json()[0].attachments.length, 2);

  const file = await me("GET", `/api/attachments/${a.id}`);
  assert.equal(file.statusCode, 200);
  assert.equal(file.body, text);
  assert.equal(file.headers["content-type"], "text/plain; charset=utf-8");
  assert.match(String(file.headers["content-disposition"]), /^inline; filename\*=UTF-8''Transkript\.txt$/);
  assert.match(String(file.headers["content-security-policy"]), /sandbox/);
  const dl = await me("GET", `/api/attachments/${a.id}?download=1`);
  assert.match(String(dl.headers["content-disposition"]), /^attachment;/);

  const part = await me("GET", `/api/attachments/${a.id}`, undefined, { range: "bytes=0-6" });
  assert.equal(part.statusCode, 206);
  assert.equal(part.body, "[11:30]");

  assert.equal((await me("DELETE", `/api/attachments/${json.json().id}`)).statusCode, 200);
  assert.equal((await me("GET", `/api/attachments/${json.json().id}`)).statusCode, 404);
  assert.equal((await me("GET", `/api/notes/${note.id}`)).json().attachments.length, 1);
});

test("a binary file keeps its bytes and type", async () => {
  const note = (await me("POST", "/api/notes", { title: "Tafel" })).json();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 255]);
  const a = (await upload(me, note.id, "Tafel.png", png, "image/png")).json();
  const file = await me("GET", `/api/attachments/${a.id}`);
  assert.equal(file.headers["content-type"], "image/png");
  assert.deepEqual(file.rawPayload, png);
  const { cleanType } = await import("../services/attachments");
  assert.equal(cleanType("not a type"), "application/octet-stream");
  assert.equal(cleanType(undefined), "application/octet-stream");
  assert.equal(cleanType("Text/Markdown; charset=utf-8"), "text/markdown");
});

test("empty, missing note, someone else's", async () => {
  const note = (await me("POST", "/api/notes", { title: "Mine" })).json();
  assert.equal((await upload(me, note.id, "leer.txt", "", "text/plain")).statusCode, 400);
  assert.equal((await upload(me, "nope", "a.txt", "a", "text/plain")).statusCode, 404);
  assert.equal((await upload(anna, note.id, "a.txt", "a", "text/plain")).statusCode, 404);
  const a = (await upload(me, note.id, "a.txt", "a", "text/plain")).json();
  assert.equal((await anna("GET", `/api/attachments/${a.id}`)).statusCode, 404);
  assert.equal((await anna("DELETE", `/api/attachments/${a.id}`)).statusCode, 404);
  assert.equal((await me("GET", `/api/attachments/${a.id}`)).statusCode, 200);
});

test("deleting a note deletes its files; the sync feed sees attachment changes", async () => {
  const note = (await me("POST", "/api/notes", { title: "Weg" })).json();
  const since = (await me("GET", "/api/sync/changes")).json().cursor as string;
  const a = (await upload(me, note.id, "a.txt", "a", "text/plain")).json();
  const changed = (await me("GET", `/api/sync/changes?since=${encodeURIComponent(since)}`)).json();
  assert.deepEqual(changed.notes.find((n: { id: string }) => n.id === note.id)?.attachments?.map((x: { id: string }) => x.id), [a.id]);

  const files = join(dir, "attachments");
  const count = () => readdirSync(files, { recursive: true }).filter((f) => String(f).includes("-")).length;
  const before = count();
  await me("DELETE", `/api/notes/${note.id}`);
  assert.equal(count(), before - 1);
  assert.equal((await me("GET", `/api/attachments/${a.id}`)).statusCode, 404);
  assert.ok(existsSync(files));
});
