import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FastifyInstance } from "fastify";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-mcp-"));
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
let base: string;
const clients: Client[] = [];
let ip = 0;

before(async () => {
  const { buildApp } = await import("../app");
  app = await buildApp();
  base = await app.listen({ port: 0, host: "127.0.0.1" });
});
after(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function login(username: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "cf-connecting-ip": `198.51.100.${++ip}` },
    payload: { username, password },
  });
  assert.equal(res.statusCode, 200, res.body);
  return `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`;
}

async function tokenFor(cookie: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/tokens",
    headers: { cookie, "cf-connecting-ip": `198.51.100.${++ip}` },
    payload: { name: "mcp" },
  });
  return res.json().token as string;
}

async function connect(token: string) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", base), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  clients.push(client);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = (r: CallToolResult) => (r.content[0] as { text: string }).text;
  const ok = async (name: string, args?: Record<string, unknown>) => {
    const r = await call(name, args);
    assert.ok(!r.isError, `${name}: ${text(r)}`);
    return JSON.parse(text(r));
  };
  const err = async (name: string, args?: Record<string, unknown>) => {
    const r = await call(name, args);
    assert.ok(r.isError, `${name} should fail: ${text(r)}`);
    return text(r);
  };
  return { client, ok, err };
}

const setFixture = (id: string) => ({
  ...JSON.parse(readFileSync(join(contentDir, "exercises", "als-oder-wenn.json"), "utf8")),
  id,
  title: `Set ${id}`,
});

let admin: Awaited<ReturnType<typeof connect>>;
let anna: Awaited<ReturnType<typeof connect>>;

test("no token, a cookie, or a bad token: 401", async () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const cookie = await login("yamen", "admin-password");
  const extras: Record<string, string>[] = [{}, { cookie }, { authorization: "Bearer mdb_nope" }];
  for (const extra of extras) {
    const res = await fetch(new URL("/mcp", base), { method: "POST", body, headers: { ...headers, ...extra } });
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate") ?? "", /^Bearer/);
  }
  assert.equal((await fetch(new URL("/mcp", base))).status, 405);
});

test("initialize: instructions and every tool, with annotations", async () => {
  admin = await connect(await tokenFor(await login("yamen", "admin-password")));
  assert.match(admin.client.getInstructions() ?? "", /get_authoring_guide/);
  const { tools } = await admin.client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "add_words_to_group", "create_note", "create_vocab_group", "delete_content", "delete_note",
    "delete_vocab", "delete_vocab_group", "get_authoring_guide", "get_cheatsheet", "get_exercise_set",
    "get_note", "get_progress", "get_vocab", "list_cheatsheets", "list_exercise_sets", "list_notes",
    "list_vocab", "list_vocab_groups", "remove_word_from_group", "save_cheatsheet", "save_exercise_set",
    "save_vocab", "update_note", "validate_content", "whoami",
  ]);
  const save = tools.find((t) => t.name === "save_exercise_set")!;
  // The real schema, so the agent sees every item type and field.
  const schemaText = JSON.stringify(save.inputSchema);
  for (const type of ["multiple_choice", "cloze", "conjugation_table", "grading"]) {
    assert.ok(schemaText.includes(type), type);
  }
  assert.equal(tools.find((t) => t.name === "delete_content")!.annotations?.destructiveHint, true);
  assert.equal(tools.find((t) => t.name === "list_notes")!.annotations?.readOnlyHint, true);
  assert.deepEqual(await admin.ok("whoami"), { username: "yamen", role: "admin" });
});

test("the authoring guide is the Import page's, adapted for tools", async () => {
  const r = await admin.client.callTool({ name: "get_authoring_guide", arguments: { kind: "exercise" } });
  const guide = (r.content as { text: string }[])[0]!.text;
  assert.match(guide, /"type":"conjugation_table"/);
  assert.match(guide, /save_exercise_set/);
  assert.doesNotMatch(guide, /Output ONLY|<describe/);
  const sheet = (await admin.client.callTool({ name: "get_authoring_guide", arguments: { kind: "cheatsheet" } }))
    .content as { text: string }[];
  assert.doesNotMatch(sheet[0]!.text, /\n-\s*$|Output ONLY/);
});

test("library: list, get, validate, save, overwrite guard", async () => {
  const sets = await admin.ok("list_exercise_sets");
  const builtIn = sets.find((s: { id: string }) => s.id === "als-oder-wenn");
  assert.equal(builtIn.source, "built-in");
  assert.equal(builtIn.canDelete, false);
  assert.equal((await admin.ok("get_exercise_set", { id: "als-oder-wenn" })).id, "als-oder-wenn");
  assert.match(await admin.err("get_exercise_set", { id: "nope" }), /list_exercise_sets/);

  // Validation reports precise paths without saving.
  const broken = setFixture("mcp-set");
  broken.items[0] = { id: "x", type: "multiple_choice", prompt: "?", choices: ["a", "a"], answerIndex: 5 };
  const v = await admin.ok("validate_content", { kind: "exercise", data: broken });
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e: string) => e.startsWith("items.0.answerIndex:")), v.errors.join("\n"));
  assert.ok(v.errors.some((e: string) => e.startsWith("items.0.choices:")));
  assert.deepEqual(await admin.ok("validate_content", { kind: "exercise", data: setFixture("mcp-set") }), {
    valid: true, id: "mcp-set", id_status: '"mcp-set" is free',
  });

  // The tool's input schema rejects malformed content too.
  assert.match(await admin.err("save_exercise_set", { set: broken }), /answerIndex/);
  assert.equal((await admin.ok("list_exercise_sets")).some((s: { id: string }) => s.id === "mcp-set"), false);

  assert.deepEqual(await admin.ok("save_exercise_set", { set: setFixture("mcp-set") }), {
    saved: "mcp-set", replaced: false, items: setFixture("mcp-set").items.length,
  });
  assert.match(await admin.err("save_exercise_set", { set: setFixture("mcp-set") }), /overwrite: true/);
  assert.equal((await admin.ok("save_exercise_set", { set: setFixture("mcp-set"), overwrite: true })).replaced, true);
  const listed = (await admin.ok("list_exercise_sets")).find((s: { id: string }) => s.id === "mcp-set");
  assert.equal(listed.source, "imported");
  assert.equal(listed.createdBy, "yamen");

  await admin.ok("save_cheatsheet", { sheet: { id: "mcp-sheet", title: "Dativ", sections: [{ heading: "Was?", body: "**mit**" }] } });
  assert.equal((await admin.ok("get_cheatsheet", { id: "mcp-sheet" })).category, "general");
});

test("only the importer or an admin replaces or deletes; built-ins stay", async () => {
  const adminCookie = await login("yamen", "admin-password");
  await app.inject({
    method: "PUT", url: "/api/admin/registration",
    headers: { cookie: adminCookie, "cf-connecting-ip": `198.51.100.${++ip}` }, payload: { open: true },
  });
  for (const name of ["anna", "ben"]) {
    const res = await app.inject({
      method: "POST", url: "/api/auth/register",
      headers: { "cf-connecting-ip": `198.51.100.${++ip}` }, payload: { username: name, password: `${name}-password` },
    });
    assert.equal(res.statusCode, 200, res.body);
  }
  anna = await connect(await tokenFor(await login("anna", "anna-password")));
  const ben = await connect(await tokenFor(await login("ben", "ben-password")));

  assert.match(await anna.err("save_exercise_set", { set: setFixture("mcp-set"), overwrite: true }), /someone else/);
  assert.match(await anna.err("save_exercise_set", { set: setFixture("als-oder-wenn") }), /built-in/);
  assert.match((await anna.ok("validate_content", { kind: "exercise", data: setFixture("mcp-set") })).id_status, /someone else/);
  assert.match(await anna.err("delete_content", { id: "mcp-set" }), /importer or an admin/);
  assert.match(await anna.err("delete_content", { id: "als-oder-wenn" }), /built-in/);

  await anna.ok("save_exercise_set", { set: setFixture("anna-set") });
  assert.match(await ben.err("delete_content", { id: "anna-set" }), /importer or an admin/);
  assert.equal((await anna.ok("list_exercise_sets")).find((s: { id: string }) => s.id === "anna-set").canDelete, true);
  assert.deepEqual(await admin.ok("delete_content", { id: "anna-set" }), { deleted: "anna-set" });
  assert.deepEqual(await admin.ok("delete_content", { id: "mcp-set" }), { deleted: "mcp-set" });
  assert.match(await admin.err("delete_content", { id: "als-oder-wenn" }), /built-in/);
});

test("vocab and groups: CRUD, private to the user", async () => {
  const saved = await anna.ok("save_vocab", {
    word: "Haus", display: "das Haus", translation: "house", examples: [{ de: "Das Haus ist alt.", en: "The house is old." }],
  });
  assert.equal(saved.word, "haus");
  const group = await anna.ok("create_vocab_group", { name: "Wohnen" });
  assert.deepEqual(await anna.ok("add_words_to_group", { group_id: group.id, words: ["haus", "Küche"] }), {
    added: ["haus"], notSaved: ["Küche"],
  });
  assert.equal((await anna.ok("list_vocab", { group_id: group.id })).length, 1);
  assert.equal((await anna.ok("list_vocab_groups"))[0].count, 1);

  // Another user can't see or touch it.
  assert.deepEqual(await admin.ok("list_vocab"), []);
  assert.equal(await admin.ok("get_vocab", { word: "haus" }), null);
  assert.match(await admin.err("delete_vocab_group", { group_id: group.id }), /No group/);
  assert.match(await admin.err("add_words_to_group", { group_id: group.id, words: ["haus"] }), /No group/);
  assert.match(await admin.err("delete_vocab", { word: "haus" }), /isn't saved/);

  await anna.ok("remove_word_from_group", { group_id: group.id, word: "Haus" });
  assert.equal((await anna.ok("list_vocab_groups"))[0].count, 0);
  await anna.ok("delete_vocab_group", { group_id: group.id });
  await anna.ok("delete_vocab", { word: "haus" });
  assert.deepEqual(await anna.ok("list_vocab"), []);
});

test("notes: CRUD, private to the user", async () => {
  const note = await anna.ok("create_note", { title: "Dativ", category: "grammatik", body: "mit + Dativ" });
  assert.equal((await anna.ok("update_note", { id: note.id, body: "aus, bei, mit" })).title, "Dativ");
  assert.equal((await anna.ok("list_notes", { category: "grammatik" })).length, 1);
  assert.equal((await anna.ok("list_notes", { category: "other" })).length, 0);

  assert.match(await admin.err("get_note", { id: note.id }), /No note/);
  assert.match(await admin.err("update_note", { id: note.id, title: "x" }), /No note/);
  assert.match(await admin.err("delete_note", { id: note.id }), /No note/);
  assert.equal((await anna.ok("get_note", { id: note.id })).body, "aus, bei, mit");

  await anna.ok("delete_note", { id: note.id });
  assert.deepEqual(await anna.ok("list_notes"), []);
});

test("progress", async () => {
  const p = await anna.ok("get_progress");
  assert.equal(p.totalAnswered, 0);
  assert.deepEqual(p.recentRuns, []);
});
