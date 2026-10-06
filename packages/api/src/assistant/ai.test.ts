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
  TTS_URL: "",
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
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.50.240", "169.254.169.254",
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
  rejects("https://192.168.50.240/v1", /private/);
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

type Call = { url: string; auth: string | null; body: { model: string; messages: unknown[] } };
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
      body: JSON.parse(String(init.body)),
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

test("first boot copies ASSISTANT_* into the admin's settings, key encrypted", async () => {
  admin = await signIn("yamen", "admin-password");
  const view = (await admin("GET", "/api/assistant/settings")).json();
  assert.deepEqual(view, {
    encryptionAvailable: true,
    configured: true,
    baseUrl: "https://ai.example.com/v1",
    model: "legacy-model",
    hasKey: true,
    keyUnreadable: false,
  });
  const { db, schema } = await import("../db/client");
  const row = db.select().from(schema.aiSettings).get()!;
  assert.ok(row.apiKeyEnc && !row.apiKeyEnc.includes(LEGACY_KEY), "stored encrypted");

  // The tutor works with it, sending the decrypted key upstream.
  const res = await admin("POST", "/api/assistant/test");
  assert.deepEqual(res.json(), { ok: true, reply: "OK" });
  assert.equal(calls.at(-1)!.url, "https://ai.example.com/v1/chat/completions");
  assert.equal(calls.at(-1)!.auth, `Bearer ${LEGACY_KEY}`);
  assert.equal(calls.at(-1)!.body.model, "legacy-model");
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
  assert.match(res.json().error, /Settings → AI tutor/);
  assert.equal(calls.length, before, "nothing was sent upstream");
});

test("saving settings: guard errors are explained, key handling is write-only", async () => {
  const put = (body: object) => anna("PUT", "/api/assistant/settings", body);
  assert.match((await put({ baseUrl: "http://ai.example.org/v1", model: "m" })).json().error, /https/);
  assert.match((await put({ baseUrl: "https://192.168.50.240/v1", model: "m" })).json().error, /private/);
  assert.match((await put({ baseUrl: "https://localhost/v1", model: "m" })).json().error, /private/);

  const saved = (await put({ baseUrl: "https://ai.example.org/v1/", model: "anna-model", apiKey: "sk-anna" })).json();
  assert.equal(saved.baseUrl, "https://ai.example.org/v1");
  assert.equal(saved.hasKey, true);
  assert.equal(saved.configured, true);

  // Omitting apiKey keeps it; null removes it.
  assert.equal((await put({ baseUrl: "https://ai.example.org/v1", model: "anna-2" })).json().hasKey, true);
  await anna("POST", "/api/assistant/test");
  assert.equal(calls.at(-1)!.auth, "Bearer sk-anna", "anna's own key");
  assert.equal(calls.at(-1)!.body.model, "anna-2");
  assert.equal((await put({ baseUrl: "https://ai.example.org/v1", model: "anna-2", apiKey: null })).json().hasKey, false);
  await anna("POST", "/api/assistant/test");
  assert.equal(calls.at(-1)!.auth, null, "no key sent once removed");

  // yamen's settings are untouched by anna's.
  await admin("POST", "/api/assistant/test");
  assert.equal(calls.at(-1)!.auth, `Bearer ${LEGACY_KEY}`);
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
  assert.match(res.json().error, /isn't allowed: it isn't a public address/);
  assert.ok(!res.body.includes("resolves to"), "doesn't echo DNS results");

  provider = () => {
    throw new Error("connect ECONNREFUSED 10.0.0.5:443");
  };
  res = await admin("POST", "/api/assistant/cleanup-notes", { text: "notes" });
  assert.equal(res.json().error, "The AI request failed.");

  provider = () => sse(["x".repeat(3 * 1024 * 1024)]);
  res = await admin("POST", "/api/assistant/test");
  assert.equal(res.json().error, "The AI response was too large.");
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

test("a key that can't be decrypted any more disables AI until re-entered", async () => {
  const { db, schema } = await import("../db/client");
  const { eq } = await import("drizzle-orm");
  const { findUserByUsername } = await import("../auth/users");
  const annaId = findUserByUsername("anna")!.id;
  await anna("PUT", "/api/assistant/settings", {
    baseUrl: "https://ai.example.org/v1", model: "m", apiKey: "sk-anna",
  });
  // Simulates ENCRYPTION_KEY having changed.
  db.update(schema.aiSettings)
    .set({ apiKeyEnc: "v1.AAAA.AAAA.AAAA" })
    .where(eq(schema.aiSettings.userId, annaId))
    .run();
  const view = (await anna("GET", "/api/assistant/settings")).json();
  assert.equal(view.keyUnreadable, true);
  assert.equal(view.configured, false);
  assert.equal((await anna("GET", "/api/assistant/status")).json().enabled, false);
});

test("the env seed runs once: removed settings don't come back on restart", async () => {
  await admin("DELETE", "/api/assistant/settings");
  const { seedAdminAiFromEnv } = await import("./config");
  seedAdminAiFromEnv(app.log);
  assert.equal((await admin("GET", "/api/assistant/settings")).json().configured, false);
});
