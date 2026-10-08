import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-native-"));
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
  ASSISTANT_API_KEY: "",
  PUBLIC_URL: "",
  DICTIONARY_API_URL: "off",
});

const ORIGIN = "https://deutsch.example.com";
const REDIRECT = "eu.yamen.wortschritt:/oauth/callback";
const APP_ORIGIN = "capacitor://localhost";

let app: FastifyInstance;
before(async () => {
  const { buildApp } = await import("../app");
  app = await buildApp();
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;
const send = (opts: InjectOptions): Promise<Res> =>
  app.inject({ ...opts, headers: { host: "deutsch.example.com", "x-forwarded-proto": "https", ...(opts.headers ?? {}) } });
const form = (url: string, body: Record<string, string>) =>
  send({
    method: "POST",
    url,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(body).toString(),
  });

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function login() {
  const res = await send({ method: "POST", url: "/api/auth/login", payload: { username: "yamen", password: "admin-password" } });
  return `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`;
}

async function signInApp(cookie: string, clientId: string, extra: Record<string, string> = { scope: "app" }) {
  const { verifier, challenge } = pkce();
  const params = { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1", ...extra };
  const res = await send({ method: "POST", url: "/api/oauth/authorize", headers: { cookie }, payload: { params, approve: true } });
  assert.equal(res.statusCode, 200, res.body);
  const redirect = new URL(res.json().redirect as string);
  assert.equal(redirect.protocol, "eu.yamen.wortschritt:");
  const code = redirect.searchParams.get("code")!;
  const tok = await form("/oauth/token", { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT });
  assert.equal(tok.statusCode, 200, tok.body);
  return tok.json() as { access_token: string; refresh_token: string; scope: string };
}

test("GET /api/version is public", async () => {
  const res = await send({ method: "GET", url: "/api/version" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.json()).sort(), ["api", "appName", "minClient"]);
});

test("CORS: the app's origin may call /api with a bearer token; others and cookies may not", async () => {
  const pre = await send({
    method: "OPTIONS",
    url: "/api/stories",
    headers: { origin: APP_ORIGIN, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
  });
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers["access-control-allow-origin"], APP_ORIGIN);
  assert.match(String(pre.headers["access-control-allow-headers"]), /authorization/);
  assert.equal(pre.headers["access-control-allow-credentials"], undefined, "never with cookies");

  const get = await send({ method: "GET", url: "/api/version", headers: { origin: APP_ORIGIN } });
  assert.equal(get.headers["access-control-allow-origin"], APP_ORIGIN);
  const evil = await send({ method: "GET", url: "/api/version", headers: { origin: "https://evil.example.com" } });
  assert.equal(evil.headers["access-control-allow-origin"], undefined);
});

test("registration accepts a reverse-DNS app scheme, not other schemes", async () => {
  for (const bad of ["javascript:alert(1)", "myapp:/cb", "data:text/html,x", "eu.yamen.wortschritt:/cb#frag"]) {
    const res = await send({ method: "POST", url: "/oauth/register", payload: { redirect_uris: [bad], token_endpoint_auth_method: "none" } });
    assert.equal(res.statusCode, 400, bad);
  }
  const ok = await send({
    method: "POST",
    url: "/oauth/register",
    payload: { client_name: "Wortschritt (Android)", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] },
  });
  assert.equal(ok.statusCode, 201, ok.body);
});

test("an app-scope token works on the REST API (and refreshes), but not on /mcp; an MCP token not on the API", async () => {
  const cookie = await login();
  const reg = await send({
    method: "POST",
    url: "/oauth/register",
    payload: { client_name: "Android", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] },
  });
  const clientId = reg.json().client_id as string;

  const t = await signInApp(cookie, clientId);
  assert.equal(t.scope, "app");
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const me = await send({ method: "GET", url: "/api/stories", headers: bearer(t.access_token) });
  assert.equal(me.statusCode, 200, me.body);
  const mcp = await send({
    method: "POST",
    url: "/mcp",
    headers: { ...bearer(t.access_token), "content-type": "application/json", accept: "application/json, text/event-stream" },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  assert.equal(mcp.statusCode, 401, "an app token isn't an MCP token");
  // Things only a browser session may do stay off-limits.
  assert.equal((await send({ method: "GET", url: "/api/auth/tokens", headers: bearer(t.access_token) })).statusCode, 403);

  const refreshed = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId });
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  assert.equal(refreshed.json().scope, "app");
  assert.equal((await send({ method: "GET", url: "/api/stories", headers: bearer(refreshed.json().access_token) })).statusCode, 200);
  assert.equal((await send({ method: "GET", url: "/api/stories", headers: bearer(t.access_token) })).statusCode, 401, "rotated");

  // The resource parameter alone selects the app scope; mismatches are refused.
  const viaResource = await signInApp(cookie, clientId, { resource: `${ORIGIN}/api` });
  assert.equal(viaResource.scope, "app");
  const mcpToken = await signInApp(cookie, clientId, {});
  assert.equal(mcpToken.scope, "mcp");
  assert.equal((await send({ method: "GET", url: "/api/stories", headers: bearer(mcpToken.access_token) })).statusCode, 401);
  const { challenge } = pkce();
  const mismatch = await send({
    method: "POST",
    url: "/api/oauth/authorize",
    headers: { cookie },
    payload: {
      params: { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", scope: "app", resource: `${ORIGIN}/mcp` },
      approve: true,
    },
  });
  assert.match(String(mismatch.json().redirect), /error=invalid_target/);
  const prm = (await send({ method: "GET", url: "/.well-known/oauth-protected-resource/api" })).json();
  assert.equal(prm.resource, `${ORIGIN}/api`);
  assert.deepEqual(prm.scopes_supported, ["app"]);
});
