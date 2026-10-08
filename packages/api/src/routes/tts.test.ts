import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-tts-"));
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
  ASSISTANT_API_KEY: "",
  DICTIONARY_API_URL: "off",
  ENCRYPTION_KEY: "test-encryption-key-that-is-long-enough",
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

// Calls to Azure go through the egress guard's transport; record them.
const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
before(async () => {
  const { buildApp } = await import("../app");
  const { setTransportForTests } = await import("../assistant/egress");
  setTransportForTests(async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    return new Response(new Uint8Array([0xff, 0xf3, 1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } }) as never;
  });
  app = await buildApp();
  me = await login("yamen", "admin-password");
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const tts = (voice: string, text: string) => me("GET", `/api/tts?${new URLSearchParams({ voice, text })}`);

test("no providers: no server voices, and cloud voices are refused", async () => {
  const status = (await me("GET", "/api/tts/status")).json();
  assert.equal(status.available, false);
  assert.deepEqual(status.voices, []);
  assert.equal((await tts("azure:de-DE-KatjaNeural", "Hallo")).statusCode, 503);
  assert.equal((await tts("edge:de-DE-KatjaNeural", "Hallo")).statusCode, 503);
  assert.deepEqual((await me("GET", "/api/admin/tts")).json(), {
    azure: { configured: false, region: "", canStoreKey: true },
    edge: { enabled: false },
  });
});

test("Azure: the admin stores a key; voices appear; synthesis is SSML to the region, escaped, cached", async () => {
  assert.equal((await me("PUT", "/api/admin/tts", { azure: { region: "westeurope" } })).statusCode, 400, "a key is needed");
  assert.equal((await me("PUT", "/api/admin/tts", { azure: { region: "evil.example.com/x", key: "k".repeat(32) } })).statusCode, 400);
  const set = await me("PUT", "/api/admin/tts", { azure: { region: "westeurope", key: "secret-azure-key-123" } });
  assert.equal(set.statusCode, 200, set.body);
  assert.equal(set.json().azure.configured, true);
  assert.ok(!set.body.includes("secret-azure-key"), "the key is never sent back");

  const status = (await me("GET", "/api/tts/status")).json();
  assert.equal(status.available, true);
  assert.ok(status.voices.some((v: { id: string; provider: string }) => v.id === "azure:de-DE-KatjaNeural" && v.provider === "azure"));

  const res = await tts("azure:de-DE-KatjaNeural", "Tom & Jerry <sagen> „Hallo“");
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["content-type"], "audio/mpeg");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(calls[0]!.headers["Ocp-Apim-Subscription-Key"], "secret-azure-key-123");
  assert.match(calls[0]!.body, /<voice name='de-DE-KatjaNeural'>Tom &amp; Jerry &lt;sagen&gt; „Hallo“<\/voice>/);
  assert.equal((await tts("azure:de-DE-KatjaNeural", "Tom & Jerry <sagen> „Hallo“")).statusCode, 200);
  assert.equal(calls.length, 1, "served from the cache");

  assert.equal((await tts("azure:de-DE-NotAVoice", "Hallo")).statusCode, 503, "only known voices");
  // Changing the region keeps the stored key.
  assert.equal((await me("PUT", "/api/admin/tts", { azure: { region: "germanywestcentral" } })).statusCode, 200);
  await me("POST", "/api/admin/tts/test", { voice: "azure:de-DE-ConradNeural" });
  assert.equal(calls.at(-1)!.url, "https://germanywestcentral.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(calls.at(-1)!.headers["Ocp-Apim-Subscription-Key"], "secret-azure-key-123");
});

test("Edge voices are opt-in", async () => {
  assert.ok(!(await me("GET", "/api/tts/status")).json().voices.some((v: { provider: string }) => v.provider === "edge"));
  assert.equal((await me("PUT", "/api/admin/tts", { edge: true })).json().edge.enabled, true);
  assert.ok((await me("GET", "/api/tts/status")).json().installed.includes("edge:de-DE-SeraphinaMultilingualNeural"));
  await me("PUT", "/api/admin/tts", { edge: false });
});

test("the Edge protocol helpers: token and audio frames", async () => {
  const { audioFromFrame, secMsGec } = await import("../tts/edge");
  const t = Date.UTC(2026, 9, 8, 12, 0, 0);
  assert.match(secMsGec(t), /^[0-9A-F]{64}$/);
  assert.equal(secMsGec(t), secMsGec(t + 299_000), "stable within the 5-minute window");
  assert.notEqual(secMsGec(t), secMsGec(t + 300_000));
  const frame = (header: string, data: number[]) => {
    const h = Buffer.from(header);
    const b = Buffer.alloc(2);
    b.writeUInt16BE(h.length);
    return Buffer.concat([b, h, Buffer.from(data)]);
  };
  assert.deepEqual([...audioFromFrame(frame("X-RequestId:1\r\nPath:audio\r\n", [1, 2, 3]))!], [1, 2, 3]);
  assert.equal(audioFromFrame(frame("Path:audio.metadata\r\n", [1])), null, "not metadata");
  assert.deepEqual([...audioFromFrame(frame("Path:audio", [9]))!], [9]);
  assert.equal(audioFromFrame(frame("Path:turn.start\r\n", [1])), null);
  assert.equal(audioFromFrame(Buffer.from([0])), null);
});

test("only the admin manages providers", async () => {
  await me("PUT", "/api/admin/registration", { open: true });
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "anna", password: "anna-password" } });
  const anna = await login("anna", "anna-password");
  assert.equal((await anna("GET", "/api/admin/tts")).statusCode, 403);
  assert.equal((await anna("PUT", "/api/admin/tts", { edge: true })).statusCode, 403);
  assert.equal((await anna("POST", "/api/admin/tts/test", { voice: "azure:de-DE-KatjaNeural" })).statusCode, 403);
  // …but can use the voices the admin set up.
  assert.equal((await anna("GET", `/api/tts?${new URLSearchParams({ voice: "azure:de-DE-KatjaNeural", text: "Hallo Anna" })}`)).statusCode, 200);
});
