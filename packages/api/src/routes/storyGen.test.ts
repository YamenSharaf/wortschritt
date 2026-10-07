import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import { EXAMPLE_STORY } from "@mdb/shared";

// See ai.test.ts: the legacy env seeds the admin's AI settings, and the egress
// transport is replaced by a mock provider.
const dir = mkdtempSync(join(tmpdir(), "mdb-storygen-"));
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
  TTS_URL: "",
  ENCRYPTION_KEY: "test-encryption-key-that-is-long-enough",
  ASSISTANT_BASE_URL: "https://ai.example.com/v1",
  ASSISTANT_API_KEY: "sk-test",
  ASSISTANT_MODEL: "test-model",
  DICTIONARY_API_URL: "off",
});

type Msg = { role: string; content: string };
const prompts: Msg[][] = [];
/** The model's replies, in order. */
let replies: string[] = [];

function sse(text: string): Response {
  // Split into a few tokens like a real stream.
  const chunks = text.match(/[\s\S]{1,200}/g) ?? [];
  const lines = chunks.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
  return new Response(lines.join("") + "data: [DONE]\n\n", { status: 200 });
}

let app: FastifyInstance;
type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;
let me: (method: InjectOptions["method"], url: string, payload?: unknown) => Promise<Res>;
before(async () => {
  const egress = await import("../assistant/egress");
  egress.setTransportForTests(async (_url, init) => {
    prompts.push((JSON.parse(String(init.body)) as { messages: Msg[] }).messages);
    return sse(replies.shift() ?? "") as never;
  });
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
beforeEach(() => {
  prompts.length = 0;
});

/** The SSE events of a generation request. */
async function generate(body: object): Promise<{ status: number; events: Record<string, unknown>[] }> {
  const res = await me("POST", "/api/stories/generate", body);
  const events = res.body
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
  assert.ok(res.statusCode !== 200 || res.body.trimEnd().endsWith("data: [DONE]"), "stream ends with [DONE]");
  return { status: res.statusCode, events };
}
const done = (events: Record<string, unknown>[]) => events.find((e) => e.done)?.done as { id: string; questionsDropped: boolean } | undefined;

const SET = "als-oder-wenn";

test("context: mistakes (with the right answer), weakest words first, recent topics", async () => {
  const set = (await me("GET", `/api/exercises/${SET}`)).json();
  const item = set.items[0];
  await me("POST", "/api/attempts", { setId: SET, itemId: item.id, correct: false, response: "wann" });
  await me("POST", "/api/runs", { setId: SET, setTitle: set.title, total: 1, answered: 1, correct: 0, results: {} });
  await me("POST", "/api/vocab", { word: "Baum", display: "der Baum", translation: "tree" });
  await me("POST", "/api/vocab", { word: "Wolke", display: "die Wolke", translation: "cloud" });
  await me("POST", "/api/vocab/wolke/study", { known: false });

  const c = (await me("GET", "/api/story-context?mistakes=true&vocab=true&topics=true")).json();
  assert.equal(c.level, "A1");
  assert.equal(c.mistakes.length, 1);
  assert.equal(c.mistakes[0].source, set.title);
  assert.equal(c.mistakes[0].response, "wann");
  assert.ok(c.mistakes[0].answer.length > 0);
  assert.deepEqual(c.words, ["die Wolke", "der Baum"], "the missed word first");
  assert.deepEqual(c.topics, [set.title]);
  const none = (await me("GET", "/api/story-context")).json();
  assert.deepEqual({ ...none, level: undefined }, { level: undefined, mistakes: [], words: [], topics: [] });
});

test("generate: the prompt carries the request and chosen context; id and level are the server's", async () => {
  // A model that wraps the JSON in a fence and picks its own id and level.
  replies = ["```json\n" + JSON.stringify({ ...EXAMPLE_STORY, id: "Mein Ding!", level: "C2" }) + "\n```"];
  const { status, events } = await generate({
    prompt: "Ein Sonntag am See",
    level: "B1",
    length: "short",
    questions: 2,
    vocabulary: "stretch",
    context: { mistakes: true, vocab: true, topics: false },
  });
  assert.equal(status, 200);
  assert.deepEqual(events.map((e) => e.phase ?? "done").filter((p) => p !== "writing"), ["checking", "done"]);
  const result = done(events)!;
  assert.equal(result.id, "ein-sonntag-am-see");
  assert.equal(result.questionsDropped, false);

  const saved = (await me("GET", `/api/stories/${result.id}`)).json();
  assert.equal(saved.story.level, "B1");
  assert.equal(saved.story.questions.length, 2);

  const [system, user] = prompts[0]!;
  assert.match(system!.content, /"glossary"/, "the story authoring guide");
  assert.doesNotMatch(system!.content, /<describe/);
  assert.match(user!.content, /Ein Sonntag am See/);
  assert.match(user!.content, /Level: B1\. Length: about 150 words/);
  assert.match(user!.content, /exactly 2 comprehension questions/);
  assert.match(user!.content, /about 1 in 20/);
  assert.match(user!.content, /they wrote: wann/);
  assert.match(user!.content, /die Wolke, der Baum/);
  assert.doesNotMatch(user!.content, /Recently practised/);
});

test("the same title again gets a free id", async () => {
  replies = [JSON.stringify(EXAMPLE_STORY)];
  const { events } = await generate({ prompt: "noch einmal", context: { mistakes: false, vocab: false, topics: false } });
  assert.equal(done(events)!.id, "ein-sonntag-am-see-2");
  assert.doesNotMatch(prompts[0]![1]!.content, /they wrote|learning —/);
});

test("invalid JSON gets one repair round with the exact problems", async () => {
  replies = [
    JSON.stringify({ ...EXAMPLE_STORY, title: "Reparatur", body: "" }),
    JSON.stringify({ ...EXAMPLE_STORY, title: "Reparatur" }),
  ];
  const { events } = await generate({ prompt: "x y z" });
  assert.ok(events.some((e) => e.phase === "fixing"));
  assert.equal(done(events)!.id, "reparatur");
  assert.equal(prompts.length, 2);
  const repair = prompts[1]!;
  assert.equal(repair.at(-2)!.role, "assistant");
  assert.match(repair.at(-1)!.content, /body: /);
});

test("questions still broken after the repair: the story is kept without them", async () => {
  const bad = { ...EXAMPLE_STORY, title: "Ohne Fragen", questions: [{ id: "q1", type: "multiple_choice", prompt: "?", choices: ["a"], answerIndex: 4 }] };
  replies = [JSON.stringify(bad), JSON.stringify(bad)];
  const { events } = await generate({ prompt: "x y z" });
  const result = done(events)!;
  assert.equal(result.questionsDropped, true);
  assert.deepEqual((await me("GET", `/api/stories/${result.id}`)).json().story.questions, []);
});

test("garbage twice: an error, nothing saved", async () => {
  const before = (await me("GET", "/api/stories")).json().length;
  replies = ["Es war einmal…", "Sorry, I can't do JSON."];
  const { events } = await generate({ prompt: "x y z" });
  assert.match(String(events.at(-1)!.error), /didn't pass the checks/);
  assert.equal((await me("GET", "/api/stories")).json().length, before);
});

test("without an AI set up: 503, before any streaming", async () => {
  await me("PUT", "/api/admin/registration", { open: true });
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "anna", password: "anna-password" } });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "anna", password: "anna-password" } });
  const cookie = `mdb_session=${login.cookies.find((c) => c.name === "mdb_session")!.value}`;
  const res = await app.inject({ method: "POST", url: "/api/stories/generate", headers: { cookie }, payload: { prompt: "Ein Tag" } });
  assert.equal(res.statusCode, 503);
  assert.match(res.json().error, /AI tutor/);
  // And her context is her own (empty).
  const c = await app.inject({ method: "GET", url: "/api/story-context?mistakes=true&vocab=true&topics=true", headers: { cookie } });
  assert.deepEqual({ ...(c.json() as object), level: undefined }, { level: undefined, mistakes: [], words: [], topics: [] });
});
