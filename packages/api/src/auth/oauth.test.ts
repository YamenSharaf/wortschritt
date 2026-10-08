import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-oauth-"));
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
  ASSISTANT_API_KEY: "",
  PUBLIC_URL: "",
});

const ORIGIN = "https://deutsch.example.com";
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

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
// Requests as they arrive through the Cloudflare tunnel.
const send = (opts: InjectOptions): Promise<Res> =>
  app.inject({
    ...opts,
    headers: {
      host: "deutsch.example.com",
      "x-forwarded-proto": "https",
      "cf-connecting-ip": `203.0.113.${++ip % 250}`,
      ...(opts.headers ?? {}),
    },
  });
const form = (url: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
  send({
    method: "POST",
    url,
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    payload: new URLSearchParams(body).toString(),
  });

async function login(username: string, password: string) {
  const res = await send({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  assert.equal(res.statusCode, 200, res.body);
  return `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

const mcpList = (token: string) =>
  send({
    method: "POST",
    url: "/mcp",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });

async function register(extra: Record<string, unknown> = {}) {
  const res = await send({
    method: "POST",
    url: "/oauth/register",
    payload: { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", ...extra },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { client_id: string; client_secret?: string };
}

/** Run the browser part: consent as `cookie`, return the redirect URL. */
async function authorize(cookie: string, params: Record<string, string>, approve = true) {
  const info = await send({ method: "GET", url: `/api/oauth/authorize?${new URLSearchParams(params)}`, headers: { cookie } });
  assert.equal(info.statusCode, 200, info.body);
  const res = await send({ method: "POST", url: "/api/oauth/authorize", headers: { cookie }, payload: { params, approve } });
  assert.equal(res.statusCode, 200, res.body);
  return new URL(res.json().redirect as string);
}

let adminCookie: string;
let clientId: string;
let tokens: { access_token: string; refresh_token: string };

test("discovery: 401 on /mcp points to the metadata", async () => {
  const res = await mcpList("");
  assert.equal(res.statusCode, 401);
  assert.equal(
    res.headers["www-authenticate"],
    `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
  );
  const prm = (await send({ method: "GET", url: "/.well-known/oauth-protected-resource/mcp" })).json();
  assert.equal(prm.resource, RESOURCE);
  assert.deepEqual(prm.authorization_servers, [ORIGIN]);
  const as = await send({ method: "GET", url: "/.well-known/oauth-authorization-server" });
  assert.equal(as.headers["access-control-allow-origin"], "*");
  const meta = as.json();
  assert.equal(meta.issuer, ORIGIN);
  assert.equal(meta.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  assert.equal(meta.client_id_metadata_document_supported, true);
});

test("registration validates redirect URIs", async () => {
  for (const redirect_uris of [[], ["http://evil.example.com/cb"], ["https://x.example.com/cb#frag"], "https://a.b/c"]) {
    const res = await send({ method: "POST", url: "/oauth/register", payload: { redirect_uris } });
    assert.equal(res.statusCode, 400, JSON.stringify(redirect_uris));
    assert.equal(res.json().error, "invalid_redirect_uri");
  }
  assert.ok((await register({ redirect_uris: ["http://localhost:33418/callback"] })).client_id);
});

test("full flow: register, sign in, allow, code → tokens → MCP", async () => {
  clientId = (await register()).client_id;
  adminCookie = await login("yamen", "admin-password");
  const { verifier, challenge } = pkce();
  const params = {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge,
    code_challenge_method: "S256", state: "xyz", scope: "mcp", resource: RESOURCE,
  };
  const info = await send({ method: "GET", url: `/api/oauth/authorize?${new URLSearchParams(params)}`, headers: { cookie: adminCookie } });
  assert.deepEqual(info.json(), {
    client: { name: "Claude", uri: null, redirectHost: "claude.ai" },
    username: "yamen",
  });
  const back = await authorize(adminCookie, params);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get("state"), "xyz");
  assert.equal(back.searchParams.get("iss"), ORIGIN);
  const code = back.searchParams.get("code")!;

  // Wrong verifier fails — and burns the code.
  const bad = await form("/oauth/token", { grant_type: "authorization_code", code, code_verifier: pkce().verifier, client_id: clientId, redirect_uri: REDIRECT });
  assert.equal(bad.json().error, "invalid_grant");
  const again = await form("/oauth/token", { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT });
  assert.equal(again.json().error, "invalid_grant", "codes are single-use");

  // A fresh code with the right verifier works.
  const p2 = pkce();
  const code2 = (await authorize(adminCookie, { ...params, code_challenge: p2.challenge })).searchParams.get("code")!;
  const res = await form("/oauth/token", {
    grant_type: "authorization_code", code: code2, code_verifier: p2.verifier, client_id: clientId, redirect_uri: REDIRECT, resource: RESOURCE,
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["cache-control"], "no-store");
  tokens = res.json();
  assert.equal(res.json().token_type, "Bearer");
  assert.equal(res.json().expires_in, 3600);

  const mcp = await mcpList(tokens.access_token);
  assert.equal(mcp.statusCode, 200, mcp.body);
  assert.ok(mcp.json().result.tools.length > 20);

  // Audience: the access token only works on /mcp.
  assert.equal((await send({ method: "GET", url: "/api/notes", headers: { authorization: `Bearer ${tokens.access_token}` } })).statusCode, 401);

  // It shows up under Connected apps.
  const grants = (await send({ method: "GET", url: "/api/oauth/grants", headers: { cookie: adminCookie } })).json();
  assert.equal(grants.length, 1);
  assert.equal(grants[0].clientName, "Claude");
  assert.ok(grants[0].lastUsedAt);
});

test("refresh rotates both tokens; the old ones stop working", async () => {
  const res = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
  assert.equal(res.statusCode, 200, res.body);
  const next = res.json();
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  assert.equal((await mcpList(tokens.access_token)).statusCode, 401);
  assert.equal((await mcpList(next.access_token)).statusCode, 200);
  const reuse = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
  assert.equal(reuse.json().error, "invalid_grant");
  // Another client can't use it.
  const other = (await register()).client_id;
  const stolen = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: other });
  assert.equal(stolen.json().error, "invalid_grant");
  tokens = next;
});

test("bad requests: unknown client or redirect is shown, the rest goes back to the client", async () => {
  const { challenge } = pkce();
  const base = { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" };
  const get = (p: Record<string, string>) =>
    send({ method: "GET", url: `/api/oauth/authorize?${new URLSearchParams(p)}`, headers: { cookie: adminCookie } });

  assert.equal((await get({ ...base, client_id: "mdbc_unknown" })).statusCode, 400);
  assert.equal((await get({ ...base, redirect_uri: "https://evil.example.com/cb" })).statusCode, 400);
  for (const [p, error] of [
    [{ ...base, code_challenge_method: "plain" }, "invalid_request"],
    [{ ...base, code_challenge: "" }, "invalid_request"],
    [{ ...base, scope: "admin" }, "invalid_scope"],
    [{ ...base, resource: "https://other.example.com/mcp" }, "invalid_target"],
    [{ ...base, response_type: "token" }, "unsupported_response_type"],
  ] as const) {
    const res = await get(p);
    assert.equal(new URL(res.json().redirect).searchParams.get("error"), error, JSON.stringify(p));
  }
  // Signing in is required (an API token isn't enough).
  assert.equal((await send({ method: "GET", url: `/api/oauth/authorize?${new URLSearchParams(base)}` })).statusCode, 401);
});

test("deny: access_denied back to the client, no code", async () => {
  const back = await authorize(adminCookie, {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: pkce().challenge, code_challenge_method: "S256", state: "s",
  }, false);
  assert.equal(back.searchParams.get("error"), "access_denied");
  assert.equal(back.searchParams.get("code"), null);
  assert.equal(back.searchParams.get("state"), "s");
});

test("confidential clients must authenticate (basic or post)", async () => {
  const { client_id, client_secret } = await register({ token_endpoint_auth_method: "client_secret_basic" });
  assert.ok(client_secret);
  const { verifier, challenge } = pkce();
  const params = { response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" };
  const code = (await authorize(adminCookie, params)).searchParams.get("code")!;
  const body = { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT };
  const noSecret = await form("/oauth/token", { ...body, client_id });
  assert.equal(noSecret.statusCode, 401);
  assert.equal(noSecret.json().error, "invalid_client");
  const code2 = (await authorize(adminCookie, { ...params })).searchParams.get("code")!;
  const basic = Buffer.from(`${client_id}:${client_secret}`).toString("base64");
  const ok = await form("/oauth/token", { ...body, code: code2 }, { authorization: `Basic ${basic}` });
  assert.equal(ok.statusCode, 200, ok.body);
});

test("Client ID Metadata Documents are fetched through the egress guard", async () => {
  const { setTransportForTests } = await import("../assistant/egress");
  const cimdId = "https://client.example.com/oauth/metadata.json";
  const fetched: string[] = [];
  setTransportForTests(async (url) => {
    fetched.push(url);
    return new Response(
      JSON.stringify({ client_id: cimdId, client_name: "Example Agent", redirect_uris: ["https://client.example.com/cb"], token_endpoint_auth_method: "none" }),
      { headers: { "content-type": "application/json" } },
    ) as never;
  });
  const { verifier, challenge } = pkce();
  const params = { response_type: "code", client_id: cimdId, redirect_uri: "https://client.example.com/cb", code_challenge: challenge, code_challenge_method: "S256" };
  const info = await send({ method: "GET", url: `/api/oauth/authorize?${new URLSearchParams(params)}`, headers: { cookie: adminCookie } });
  assert.equal(info.json().client.name, "Example Agent");
  const code = (await authorize(adminCookie, params)).searchParams.get("code")!;
  const res = await form("/oauth/token", { grant_type: "authorization_code", code, code_verifier: verifier, client_id: cimdId });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual([...new Set(fetched)], [cimdId], "cached after the first fetch");

  // A document whose client_id doesn't match its URL is refused.
  setTransportForTests(async () => new Response(JSON.stringify({ client_id: "https://evil.example.com/x", redirect_uris: ["https://evil.example.com/cb"] })) as never);
  const bad = await send({
    method: "GET",
    url: `/api/oauth/authorize?${new URLSearchParams({ ...params, client_id: "https://other.example.com/meta.json", redirect_uri: "https://evil.example.com/cb" })}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /doesn't match/);
  // Private addresses never get fetched.
  const local = await send({
    method: "GET",
    url: `/api/oauth/authorize?${new URLSearchParams({ ...params, client_id: "https://127.0.0.1/meta.json" })}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(local.statusCode, 400);
});

test("disconnect, revoke, or disabling the user ends access", async () => {
  await send({ method: "PUT", url: "/api/admin/registration", headers: { cookie: adminCookie }, payload: { open: true } });
  await send({ method: "POST", url: "/api/auth/register", payload: { username: "anna", password: "anna-password" } });
  const annaCookie = await login("anna", "anna-password");
  const { verifier, challenge } = pkce();
  const code = (await authorize(annaCookie, { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" })).searchParams.get("code")!;
  const anna = (await form("/oauth/token", { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId })).json();
  assert.equal((await mcpList(anna.access_token)).statusCode, 200);
  const annaId = (await send({ method: "GET", url: "/api/admin/users", headers: { cookie: adminCookie } })).json().find((u: { username: string }) => u.username === "anna").id;
  // Anna sees only her own connection and can't remove the admin's.
  const adminGrants = (await send({ method: "GET", url: "/api/oauth/grants", headers: { cookie: adminCookie } })).json();
  const annaGrants = (await send({ method: "GET", url: "/api/oauth/grants", headers: { cookie: annaCookie } })).json();
  assert.equal(annaGrants.length, 1);
  assert.ok(!adminGrants.some((g: { id: number }) => g.id === annaGrants[0].id));
  for (const g of adminGrants) {
    await send({ method: "DELETE", url: `/api/oauth/grants/${g.id}`, headers: { cookie: annaCookie } });
  }
  assert.equal((await send({ method: "GET", url: "/api/oauth/grants", headers: { cookie: adminCookie } })).json().length, adminGrants.length);

  // Disabling the user ends access.
  await send({ method: "PATCH", url: `/api/admin/users/${annaId}`, headers: { cookie: adminCookie }, payload: { disabled: true } });
  assert.equal((await mcpList(anna.access_token)).statusCode, 401);
  const refreshed = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: anna.refresh_token, client_id: clientId });
  assert.equal(refreshed.json().error, "invalid_grant");

  // Revocation endpoint.
  assert.equal((await form("/oauth/revoke", { token: tokens.refresh_token, client_id: clientId })).statusCode, 200);
  assert.equal((await mcpList(tokens.access_token)).statusCode, 401);

  // Disconnect in Settings.
  const grant = adminGrants[adminGrants.length - 1];
  const after = await send({ method: "DELETE", url: `/api/oauth/grants/${grant.id}`, headers: { cookie: adminCookie } });
  assert.ok(!after.json().some((g: { id: number }) => g.id === grant.id));
});

test("the consent page can't be framed", async () => {
  const res = await send({ method: "GET", url: "/api/health" });
  assert.equal(res.headers["x-frame-options"], "DENY");
});
