import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";

// Configure before importing anything that reads env (see auth.test.ts).
const dir = mkdtempSync(join(tmpdir(), "mdb-ai-"));
const LEGACY_KEY = "sk-legacy-env-key-123";
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
  ENCRYPTION_KEY: "test-encryption-key-that-is-long-enough",
  // The legacy single-user config, to be seeded into the admin's settings.
  ASSISTANT_BASE_URL: "https://ai.example.com/v1",
  ASSISTANT_API_KEY: LEGACY_KEY,
  ASSISTANT_MODEL: "legacy-model",
});

const egress = await import("./egress");
const secrets = await import("./secrets");

// --- unit: egress guard -------------------------------------------------------

test("isPublicAddress: private, local and special ranges are refused", () => {
  for (const ip of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.10", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fd00::1", "fe80::1", "ff02::1", "::ffff:192.168.1.1", "::ffff:7f00:1",
    "64:ff9b::a00:1",
  ]) {
    assert.equal(egress.isPublicAddress(ip), false, ip);
  }
  for (const ip of ["1.1.1.1", "104.16.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(egress.isPublicAddress(ip), true, ip);
  }
});

test("checkAiUrl: https only, public hosts, no credentials; normalizes", () => {
  const rejects = (url: string, re: RegExp) =>
    assert.throws(() => egress.checkAiUrl(url), re, url);
  rejects("http://ai.example.com/v1", /https/);
  rejects("ftp://ai.example.com", /https/);
  rejects("not a url", /valid URL/);
  rejects("https://192.168.1.10/v1", /private/);
  rejects("https://127.0.0.1:8123", /private/);
  rejects("https://[::1]/v1", /private/);
  rejects("https://[::ffff:10.0.0.1]/v1", /private/);
  rejects("https://localhost/v1", /private/);
  rejects("https://user:pass@ai.example.com/v1", /key field/);
  assert.equal(egress.checkAiUrl(" https://ai.example.com/v1/ "), "https://ai.example.com/v1");
  assert.equal(egress.checkAiUrl("https://1.1.1.1/v1"), "https://1.1.1.1/v1");
});

test("guardedLookup: a hostname resolving to a private address is refused at connect time", async () => {
  // "localhost" resolves via /etc/hosts, so this needs no network.
  const err = await new Promise<Error | null>((done) =>
    egress.guardedLookup("localhost", {}, (e) => done(e)),
  );
  assert.ok(err instanceof egress.EgressError, String(err));
});

// --- unit: secrets ------------------------------------------------------------

test("secrets: round-trip, unique ciphertexts, tampering detected", () => {
  const a = secrets.encryptSecret("sk-abc");
  const b = secrets.encryptSecret("sk-abc");
  assert.notEqual(a, b, "random IV per encryption");
  assert.ok(!a.includes("sk-abc"));
  assert.equal(secrets.decryptSecret(a), "sk-abc");
  const [v, iv, tag, ct] = a.split(".");
  const flipped = ct!.slice(0, -2) + (ct!.endsWith("AA") ? "BB" : "AA");
  assert.equal(secrets.decryptSecret([v, iv, tag, flipped].join(".")), null);
  assert.equal(secrets.decryptSecret("garbage"), null);
});

// --- integration ---------------------------------------------------------------

type Call = {
  url: string;
  auth: string | null;
  body: { model: string; messages: unknown[] } | null;
};
const calls: Call[] = [];
/** What the mock provider does next. */
let provider: (call: Call) => Response = () => sse(["O", "K"]);

function sse(tokens: string[]): Response {
  const lines = tokens.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
  return new Response(lines.join("") + "data: [DONE]\n\n", { status: 200 });
}

let app: FastifyInstance;
before(async () => {
  egress.setTransportForTests(async (url, init) => {
    const headers = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]);
    const call: Call = {
      url,
      auth: headers.get("authorization"),
      body: init.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    return provider(call) as never;
  });
  const { buildApp } = await import("../app");
  app = await buildApp();
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

let ipCounter = 0;
function client(cookie: string) {
  return (method: InjectOptions["method"], url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { cookie, "cf-connecting-ip": `203.0.113.${++ipCounter}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
}
async function signIn(username: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "cf-connecting-ip": `203.0.113.${++ipCounter}` },
    payload: { username, password },
  });
  assert.equal(res.statusCode, 200, res.body);
  return client(`mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`);
}

let admin: ReturnType<typeof client>;
let anna: ReturnType<typeof client>;

type View = {
  encryptionAvailable: boolean;
  providers: { id: number; name: string; baseUrl: string; hasKey: boolean; keyUnreadable: boolean }[];
  models: { id: number; providerId: number; model: string }[];
};
type TestResult = { results: { provider: string; model: string; ok: boolean; reply?: string; error?: string }[] };

test("first boot copies ASSISTANT_* into the admin's settings, key encrypted", async () => {
  admin = await signIn("yamen", "admin-password");
  const view = (await admin("GET", "/api/assistant/settings")).json() as View;
  assert.equal(view.encryptionAvailable, true);
  assert.equal(view.providers.length, 1);
  assert.deepEqual(
    { ...view.providers[0], id: 0 },
    { id: 0, name: "My endpoint", baseUrl: "https://ai.example.com/v1", hasKey: true, keyUnreadable: false },
  );
  assert.deepEqual(view.models.map((m) => [m.providerId, m.model]), [[view.providers[0]!.id, "legacy-model"]]);
  const { db, schema } = await import("../db/client");
  const row = db.select().from(schema.aiProviders).get()!;
  assert.ok(row.apiKeyEnc && !row.apiKeyEnc.includes(LEGACY_KEY), "stored encrypted");

  // The tutor works with it, sending the decrypted key upstream.
  const res = (await admin("POST", "/api/assistant/test")).json() as TestResult;
  assert.deepEqual(res.results.map((r) => [r.provider, r.model, r.ok, r.reply]), [
    ["My endpoint", "legacy-model", true, "OK"],
  ]);
  assert.equal(calls.at(-1)!.url, "https://ai.example.com/v1/chat/completions");
  assert.equal(calls.at(-1)!.auth, `Bearer ${LEGACY_KEY}`);
  assert.equal(calls.at(-1)!.body!.model, "legacy-model");
});

test("the key never comes back from any endpoint", async () => {
  for (const url of ["/api/assistant/settings", "/api/assistant/status", "/api/settings"]) {
    assert.ok(!(await admin("GET", url)).body.includes(LEGACY_KEY), url);
  }
});

test("another user has no AI until they set up their own", async () => {
  await admin("PUT", "/api/admin/registration", { open: true });
  const reg = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "cf-connecting-ip": "203.0.113.200" },
    payload: { username: "anna", password: "anna-password" },
  });
  assert.equal(reg.statusCode, 200);
  anna = await signIn("anna", "anna-password");

  assert.deepEqual((await anna("GET", "/api/assistant/status")).json(), { enabled: false, model: "" });
  const before = calls.length;
  const res = await anna("POST", "/api/assistant/word", { word: "Haus" });
  assert.equal(res.statusCode, 503);
  assert.match(res.json().error, /Settings → Connections/);
  assert.equal(calls.length, before, "nothing was sent upstream");
});

const providerIds = async (c: ReturnType<typeof client>) =>
  Object.fromEntries(
    ((await c("GET", "/api/assistant/settings")).json() as View).providers.map((p) => [p.name, p.id]),
  );

test("providers: guard errors are explained, keys are write-only", async () => {
  const post = (body: object) => anna("POST", "/api/assistant/providers", body);
  assert.match((await post({ name: "x", baseUrl: "http://ai.example.org/v1" })).json().error, /https/);
  assert.match((await post({ name: "x", baseUrl: "https://192.168.1.10/v1" })).json().error, /private/);

  let view = (await post({ name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1/", apiKey: "sk-or-anna" })).json() as View;
  const or = view.providers.find((p) => p.name === "OpenRouter")!;
  assert.equal(or.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(or.hasKey, true);
  assert.ok(!JSON.stringify(view).includes("sk-or-anna"));

  // Updating without a key keeps it; null removes it; a new one replaces it.
  const put = (body: object) => anna("PUT", `/api/assistant/providers/${or.id}`, body);
  assert.equal(((await put({ name: "OpenRouter", baseUrl: or.baseUrl })).json() as View).providers[0]!.hasKey, true);
  assert.equal(((await put({ name: "OpenRouter", baseUrl: or.baseUrl, apiKey: null })).json() as View).providers[0]!.hasKey, false);
  view = (await put({ name: "OpenRouter", baseUrl: or.baseUrl, apiKey: "sk-or-anna" })).json() as View;
  assert.equal(view.providers[0]!.hasKey, true);

  // Not anyone else's: admin's provider can't be changed, listed or used by anna.
  const adminProvider = (await providerIds(admin))["My endpoint"];
  assert.equal((await anna("PUT", `/api/assistant/providers/${adminProvider}`, { name: "x", baseUrl: or.baseUrl })).statusCode, 404);
  assert.equal((await anna("GET", `/api/assistant/providers/${adminProvider}/models`)).statusCode, 404);
  assert.equal((await anna("PUT", "/api/assistant/models", { models: [{ providerId: adminProvider, model: "m" }] })).statusCode, 400);
  await anna("DELETE", `/api/assistant/providers/${adminProvider}`);
  assert.equal((await providerIds(admin))["My endpoint"], adminProvider, "still there");
});

test("model list: OpenRouter pages are followed, names and prices per 1M tokens", async () => {
  provider = (call) => {
    if (call.url === "https://openrouter.ai/api/v1/models") {
      return Response.json({
        data: [
          { id: "openai/gpt-4o-mini", name: "OpenAI: GPT-4o-mini", context_length: 128000,
            pricing: { prompt: "0.00000015", completion: "0.0000006" } },
        ],
        links: { next: "/api/v1/models?offset=1&limit=1" },
      });
    }
    if (call.url === "https://openrouter.ai/api/v1/models?offset=1&limit=1") {
      return Response.json({ data: [{ id: "anthropic/claude-x", name: "Claude X", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" } }], links: { next: null } });
    }
    return new Response("not found", { status: 404 });
  };
  const id = (await providerIds(anna))["OpenRouter"];
  const res = await anna("GET", `/api/assistant/providers/${id}/models`);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), [
    { id: "anthropic/claude-x", name: "Claude X", contextLength: 200000, promptPrice: 3, completionPrice: 15 },
    { id: "openai/gpt-4o-mini", name: "OpenAI: GPT-4o-mini", contextLength: 128000, promptPrice: 0.15, completionPrice: 0.6 },
  ]);
  assert.equal(calls.at(-1)!.auth, "Bearer sk-or-anna");

  // A plain OpenAI-style list (ids only) works too; a provider without one says so.
  provider = () => Response.json({ object: "list", data: [{ id: "llama3.1" }] });
  assert.deepEqual((await anna("GET", `/api/assistant/providers/${id}/models`)).json(), [
    { id: "llama3.1", name: null, contextLength: null, promptPrice: null, completionPrice: null },
  ]);
  provider = () => new Response("<html>", { status: 200 });
  assert.match((await anna("GET", `/api/assistant/providers/${id}/models`)).json().error, /doesn't offer a model list/);
  provider = () => sse(["O", "K"]);
});

test("fallback: try A, then B — before the answer starts, never mid-answer", async () => {
  await anna("POST", "/api/assistant/providers", { name: "Backup", baseUrl: "https://backup.example.net/v1", apiKey: "sk-backup" });
  const ids = await providerIds(anna);
  const view = (await anna("PUT", "/api/assistant/models", {
    models: [
      { providerId: ids["OpenRouter"], model: "anthropic/claude-x" },
      { providerId: ids["Backup"], model: "backup-model" },
    ],
  })).json() as View;
  assert.deepEqual(view.models.map((m) => m.model), ["anthropic/claude-x", "backup-model"]);
  assert.deepEqual((await anna("GET", "/api/assistant/status")).json(), { enabled: true, model: "anthropic/claude-x" });

  const hosts = () => calls.slice(-2).map((c) => new URL(c.url).host);
  // A is down (503) → B answers.
  provider = (c) => (c.url.includes("openrouter.ai") ? new Response("down", { status: 503 }) : sse(["Haus"]));
  let res = await anna("POST", "/api/assistant/cleanup-notes", { text: "notes" });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { text: "Haus" });
  assert.deepEqual(hosts(), ["openrouter.ai", "backup.example.net"]);
  assert.equal(calls.at(-1)!.auth, "Bearer sk-backup");
  assert.equal(calls.at(-1)!.body!.model, "backup-model");

  // A wrong key (401) or a network error also falls through.
  provider = (c) => (c.url.includes("openrouter.ai") ? new Response("no", { status: 401 }) : sse(["ok"]));
  assert.equal((await anna("POST", "/api/assistant/cleanup-notes", { text: "n" })).statusCode, 200);
  provider = (c) => {
    if (c.url.includes("openrouter.ai")) throw new Error("connect ETIMEDOUT");
    return sse(["ok"]);
  };
  assert.equal((await anna("POST", "/api/assistant/cleanup-notes", { text: "n" })).statusCode, 200);

  // Streaming: falls back before the first token…
  provider = (c) => (c.url.includes("openrouter.ai") ? new Response("down", { status: 500 }) : sse(["Der ", "Dativ"]));
  res = await anna("POST", "/api/assistant/ask", { task: "highlight", selection: "dem Kind" });
  assert.match(res.body, /"token":"Der "/);
  assert.doesNotMatch(res.body, /"error"/);

  // …but once A has started answering, a later failure isn't retried on B.
  provider = (c) => {
    if (!c.url.includes("openrouter.ai")) return sse(["B!"]);
    const enc = new TextEncoder();
    // Delivers the first chunk, then the connection drops on the next read.
    let sent = false;
    const body = new ReadableStream({
      pull(ctrl) {
        if (sent) return ctrl.error(new Error("connection reset"));
        sent = true;
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Halb" } }] })}\n\n`));
      },
    });
    return new Response(body, { status: 200 });
  };
  const before = calls.length;
  res = await anna("POST", "/api/assistant/ask", { task: "highlight", selection: "dem Kind" });
  assert.match(res.body, /"token":"Halb"/);
  assert.match(res.body, /"error":"The AI request failed\."/);
  assert.doesNotMatch(res.body, /B!/);
  assert.equal(calls.length - before, 1, "B was not called");

  // All fail → the first model's error.
  provider = (c) => new Response("x", { status: c.url.includes("openrouter.ai") ? 503 : 429 });
  res = await anna("POST", "/api/assistant/cleanup-notes", { text: "n" });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, "The AI provider answered 503.");

  // Test connection checks each model on its own.
  provider = (c) => (c.url.includes("openrouter.ai") ? new Response("x", { status: 402 }) : sse(["OK"]));
  const test = (await anna("POST", "/api/assistant/test")).json() as TestResult;
  assert.deepEqual(test.results.map((r) => [r.provider, r.ok, r.error ?? r.reply]), [
    ["OpenRouter", false, "The AI provider answered 402."],
    ["Backup", true, "OK"],
  ]);
  provider = () => sse(["O", "K"]);
});

test("provider errors: status shown, upstream body and internals never leaked", async () => {
  provider = () => new Response("secret-internal-detail", { status: 401 });
  let res = await admin("POST", "/api/assistant/word", { word: "Haus" });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, "The AI provider answered 401.");
  assert.ok(!res.body.includes("secret-internal-detail"));

  provider = () => {
    throw new TypeError("fetch failed", {
      cause: new egress.EgressError("ai.example.com resolves to a non-public address"),
    });
  };
  res = await admin("POST", "/api/assistant/test");
  assert.match(res.json().results[0].error, /isn't allowed: it isn't a public address/);
  assert.ok(!res.body.includes("resolves to"), "doesn't echo DNS results");

  provider = () => {
    throw new Error("connect ECONNREFUSED 10.0.0.5:443");
  };
  res = await admin("POST", "/api/assistant/cleanup-notes", { text: "notes" });
  assert.equal(res.json().error, "The AI request failed.");

  provider = () => sse(["x".repeat(3 * 1024 * 1024)]);
  res = await admin("POST", "/api/assistant/test");
  assert.equal(res.json().results[0].error, "The AI response was too large.");
  provider = () => sse(["O", "K"]);
});

test("generate more: the server writes items from your mistakes, keeps and grades them", async () => {
  const SET = "als-oder-wenn";
  // A mistake in aw-02 ("Als ich Schülerin war…"): it should lead the examples.
  await admin("POST", "/api/answers", { setId: SET, itemId: "aw-02", response: { type: "cloze", blanks: { 1: "wenn" } } });
  const good = { type: "cloze", text: "{{1}} ich klein war, hatte ich einen Hund.", blanks: [{ ref: "1", answer: { accept: ["Als"] } }] };
  const bad = { type: "cloze", text: "no placeholder here", blanks: [{ ref: "1", answer: { accept: ["x"] } }] };
  provider = () => sse([JSON.stringify({ items: [good, bad] })]);

  let res = await admin("POST", `/api/exercises/${SET}/generate`, { count: 2 });
  assert.equal(res.statusCode, 200, res.body);
  const { items, received } = res.json() as { items: { id: string; text: string }[]; received: number };
  assert.equal(received, 2);
  assert.equal(items.length, 1, "the invalid one is dropped");
  assert.match(items[0]!.id, /^gen-/);
  const user = JSON.stringify(calls.at(-1)!.body!.messages);
  assert.ok(user.indexOf("Schülerin") > 0 && user.indexOf("Schülerin") < user.indexOf("Großmutter"), "your mistake comes first");

  // Kept for you: listed with the set, graded, scored, synced.
  assert.deepEqual((await admin("GET", `/api/exercises/${SET}/generated`)).json(), items);
  res = await admin("POST", "/api/answers", { setId: SET, itemId: items[0]!.id, response: { type: "cloze", blanks: { 1: "als" } } });
  assert.deepEqual(res.json(), { correct: true, grading: "auto" });
  await admin("POST", "/api/runs", { setId: SET, done: true });
  const run = (await admin("GET", `/api/runs/${SET}`)).json();
  assert.equal(run.total, (await admin("GET", `/api/exercises/${SET}`)).json().items.length + 1);
  const synced = (await admin("GET", "/api/sync/changes")).json();
  assert.deepEqual(synced.generated, [{ setId: SET, items }]);
  const cursor = synced.cursor;

  // Removed: gone from the set, the sync feed says so, and it can't be answered.
  assert.deepEqual((await admin("DELETE", `/api/exercises/${SET}/generated`)).json(), { removed: 1 });
  assert.deepEqual((await admin("GET", `/api/exercises/${SET}/generated`)).json(), []);
  assert.deepEqual((await admin("GET", `/api/sync/changes?since=${cursor}`)).json().deleted.generated, [SET]);
  res = await admin("POST", "/api/answers", { setId: SET, itemId: items[0]!.id, response: { type: "cloze", blanks: { 1: "als" } } });
  assert.equal(res.statusCode, 404);

  assert.equal((await admin("POST", "/api/exercises/no-such-set/generate", { count: 1 })).statusCode, 404);
  provider = () => sse(["O", "K"]);
});

test("grading: the server asks the tutor about a free-text miss; open items say the answers are examples", async () => {
  provider = () => sse(['{"correct": true, "feedback": "Fits the task."}']);
  const answer = (setId: string, itemId: string, text: string) =>
    admin("POST", "/api/answers", { setId, itemId, response: { type: "transform", text } });

  const before = calls.length;
  let res = await answer("infinitiv-zu-frei", "iz-a01", "Für mich ist es wichtig, oft zu reisen.");
  assert.deepEqual(res.json(), { correct: true, grading: "ai", feedback: "Fits the task." });
  let user = JSON.stringify(calls.at(-1)!.body!.messages);
  assert.match(user, /Example answers \(open-ended/);

  res = await answer("perfekt-bilden", "pfd-01", "Ich habe den größten Kuchen gegessen.");
  assert.equal(res.json().grading, "ai");
  user = JSON.stringify(calls.at(-1)!.body!.messages);
  assert.match(user, /Reference answer\(s\)/);
  assert.doesNotMatch(user, /Example answers \(open-ended/);

  // A match by the item's own rules never reaches the tutor.
  const asked = calls.length;
  res = await answer("perfekt-bilden", "pfd-01", "Ich habe das größte Stück Kuchen gegessen.");
  assert.deepEqual(res.json(), { correct: true, grading: "auto" });
  assert.equal(calls.length, asked);
  assert.equal(asked - before, 2);

  // AI grading off in Settings: no tutor, the item's own rules decide.
  const settings = (await admin("GET", "/api/settings")).json();
  await admin("PUT", "/api/settings", { ...settings, llmGrading: false });
  res = await answer("perfekt-bilden", "pfd-01", "Ich esse Kuchen.");
  assert.deepEqual(res.json(), { correct: false, grading: "auto" });
  assert.equal(calls.length, asked);
  await admin("PUT", "/api/settings", { ...settings, llmGrading: true });

  // The tutor failing falls back to the no-tutor rule.
  provider = () => new Response("down", { status: 500 });
  res = await answer("infinitiv-zu-frei", "iz-a01", "Für mich ist es wichtig, zu schlafen.");
  assert.deepEqual(res.json(), { correct: true, grading: "ungraded" });
  provider = () => sse(["O", "K"]);
});

test("translations: the tutor says right, almost or wrong with a correction; without a verdict it's wrong", async () => {
  const SET = "uebersetzen-perfekt";
  const answer = (text: string) => admin("POST", "/api/answers", { setId: SET, itemId: "tp-05", response: { type: "translate", text } });

  // One of the item's own translations: right, no tutor asked.
  const asked = calls.length;
  let res = await answer("Ich habe meine Schlüssel vergessen.");
  assert.deepEqual(res.json(), { correct: true, grading: "auto" });
  assert.equal(calls.length, asked);

  // Anything else goes to the tutor, with the English and the examples.
  provider = () => sse(['{"verdict": "almost", "corrected": "Ich habe meine Schlüssel vergessen.", "feedback": "Schlüssel is plural here."}']);
  res = await answer("Ich habe meinen Schlüssel vergessen.");
  assert.deepEqual(res.json(), { correct: false, grading: "ai", almost: true, corrected: "Ich habe meine Schlüssel vergessen.", feedback: "Schlüssel is plural here." });
  const user = JSON.stringify(calls.at(-1)!.body!.messages);
  assert.match(user, /English: I forgot my keys\./);
  assert.match(user, /Learner's German: Ich habe meinen Schlüssel vergessen\./);

  provider = () => sse(['{"verdict": "correct", "corrected": "", "feedback": "Good: object first is fine."}']);
  res = await answer("Meine Schlüssel habe ich vergessen.");
  assert.deepEqual(res.json(), { correct: true, grading: "ai", feedback: "Good: object first is fine." });

  // No usable verdict: the item's own rules decide.
  provider = () => sse(["I think it's fine."]);
  res = await answer("Schlüssel vergessen ich.");
  assert.deepEqual(res.json(), { correct: false, grading: "auto" });
  provider = () => sse(["O", "K"]);
});

test("streaming tutor relays tokens and reports errors safely", async () => {
  provider = () => sse(["Der ", "Dativ"]);
  let res = await admin("POST", "/api/assistant/ask", { task: "highlight", selection: "dem Kind" });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"token":"Der "/);
  assert.match(res.body, /"token":"Dativ"/);
  assert.match(res.body, /data: \[DONE\]/);

  provider = () => new Response("upstream says: internal stack trace", { status: 500 });
  res = await admin("POST", "/api/assistant/ask", { task: "highlight", selection: "dem Kind" });
  assert.match(res.body, /The AI provider answered 500/);
  assert.ok(!res.body.includes("stack trace"));
  provider = () => sse(["O", "K"]);
});

test("a key that can't be decrypted any more: flagged, and that provider is skipped", async () => {
  const { db, schema } = await import("../db/client");
  const { eq } = await import("drizzle-orm");
  const ids = await providerIds(anna);
  // Simulates ENCRYPTION_KEY having changed for the OpenRouter key.
  db.update(schema.aiProviders)
    .set({ apiKeyEnc: "v1.AAAA.AAAA.AAAA" })
    .where(eq(schema.aiProviders.id, ids["OpenRouter"]!))
    .run();
  const view = (await anna("GET", "/api/assistant/settings")).json() as View;
  assert.equal(view.providers.find((p) => p.name === "OpenRouter")!.keyUnreadable, true);
  // The backup model still works.
  assert.deepEqual((await anna("GET", "/api/assistant/status")).json(), { enabled: true, model: "backup-model" });
});

test("deleting a provider removes its models; turning off removes everything", async () => {
  const ids = await providerIds(anna);
  let view = (await anna("DELETE", `/api/assistant/providers/${ids["OpenRouter"]}`)).json() as View;
  assert.deepEqual(view.models.map((m) => m.model), ["backup-model"]);
  view = (await anna("DELETE", "/api/assistant/settings")).json() as View;
  assert.deepEqual([view.providers, view.models], [[], []]);
  assert.equal((await anna("GET", "/api/assistant/status")).json().enabled, false);
});

test("the env seed runs once: removed settings don't come back on restart", async () => {
  await admin("DELETE", "/api/assistant/settings");
  const { seedAdminAiFromEnv } = await import("./config");
  seedAdminAiFromEnv(app.log);
  const view = (await admin("GET", "/api/assistant/settings")).json() as View;
  assert.equal(view.providers.length, 0);
});

test("a model that rejects a parameter: adjusted, retried once and remembered", async () => {
  const { collectCompletion, resetQuirksForTests } = await import("./client");
  resetQuirksForTests();
  const cfg = { entryId: 1, provider: "Omniroute", baseUrl: "https://ai.example.com/v1", model: "claude-new", apiKey: "k" };
  const msgs = [{ role: "user", content: "x" }];
  const body = (c: Call) => c.body as unknown as Record<string, unknown>;
  // Verbatim from Omniroute → Anthropic for a model without temperature.
  const noTemperature = JSON.stringify({
    error: { message: "[400]: `temperature` is deprecated for this model.", type: "invalid_request_error", code: "bad_request" },
  });
  provider = (c) => ("temperature" in body(c) ? new Response(noTemperature, { status: 400 }) : sse(["O", "K"]));
  calls.length = 0;
  assert.equal(await collectCompletion([cfg], msgs, { temperature: 0, maxTokens: 16 }), "OK");
  assert.equal(calls.length, 2);
  assert.equal("temperature" in body(calls[1]!), false);
  assert.equal(body(calls[1]!).max_tokens, 16);

  // Remembered: right the first time from now on; other models unaffected.
  calls.length = 0;
  await collectCompletion([cfg], msgs, { temperature: 0.8, maxTokens: 100 });
  assert.equal(calls.length, 1);
  calls.length = 0;
  provider = () => sse(["O", "K"]);
  await collectCompletion([{ ...cfg, model: "other" }], msgs, { temperature: 0.3, maxTokens: 50 });
  assert.equal(body(calls[0]!).temperature, 0.3);

  // OpenAI-style: max_tokens → max_completion_tokens (→ no limit if that's refused too).
  const openai = { ...cfg, model: "o-reasoner" };
  provider = (c) =>
    "max_tokens" in body(c)
      ? new Response(
          JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }),
          { status: 400 },
        )
      : sse(["O", "K"]);
  calls.length = 0;
  assert.equal(await collectCompletion([openai], msgs, { temperature: 0, maxTokens: 16 }), "OK");
  assert.equal(body(calls.at(-1)!).max_completion_tokens, 16);
  assert.equal("max_tokens" in body(calls.at(-1)!), false);

  // Any other 400 is a real error: no retry.
  provider = () => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 400 });
  calls.length = 0;
  await assert.rejects(collectCompletion([{ ...cfg, model: "nope" }], msgs, { temperature: 0, maxTokens: 16 }), /answered 400/);
  assert.equal(calls.length, 1);
  provider = () => sse(["O", "K"]);
});
