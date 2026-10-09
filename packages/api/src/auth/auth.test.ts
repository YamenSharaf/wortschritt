import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";

// env.ts and db/client.ts read process.env at import time, so configure a
// throwaway database first and import the app afterwards.
const dir = mkdtempSync(join(tmpdir(), "mdb-auth-"));
Object.assign(process.env, {
  APP_PASSWORD: "initial-pass",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
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

/** Every test uses its own client IP so the per-IP rate limit doesn't leak
 *  between tests. */
let ipCounter = 0;
const newIp = () => `203.0.113.${++ipCounter}`;

async function login(username: string, password: string, ip = newIp()) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "cf-connecting-ip": ip },
    payload: { username, password },
  });
}

/** Log in and return the cookie header for follow-up requests. */
async function session(username = "yamen", password = "initial-pass"): Promise<string> {
  const res = await login(username, password);
  assert.equal(res.statusCode, 200, res.body);
  const c = res.cookies.find((c) => c.name === "mdb_session");
  assert.ok(c, "no session cookie");
  return `mdb_session=${c.value}`;
}

const get = (url: string, cookie?: string) =>
  app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });

test("admin is created from ADMIN_USERNAME and logs in with APP_PASSWORD", async () => {
  const cookie = await session();
  const me = (await get("/api/auth/me", cookie)).json();
  assert.deepEqual(me, { authenticated: true, user: { username: "yamen", role: "admin" } });
  assert.equal((await get("/api/settings", cookie)).statusCode, 200);
});

test("usernames match case-insensitively", async () => {
  assert.equal((await login("YAMEN", "initial-pass")).statusCode, 200);
});

test("wrong password and unknown user both get the same 401", async () => {
  const wrong = await login("yamen", "nope");
  const unknown = await login("nobody", "initial-pass");
  assert.equal(wrong.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.equal(wrong.body, unknown.body);
});

test("protected routes reject no cookie and the old single-user cookie", async () => {
  assert.equal((await get("/api/settings")).statusCode, 401);
  // Before multi-user, the cookie was the signed constant "ok".
  const legacy = `mdb_session=${app.signCookie("ok")}`;
  assert.equal((await get("/api/settings", legacy)).statusCode, 401);
  assert.equal((await get("/api/auth/me", legacy)).json().authenticated, false);
});

test("logout revokes the session server-side", async () => {
  const cookie = await session();
  await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
  // Replaying the old cookie no longer works.
  assert.equal((await get("/api/settings", cookie)).statusCode, 401);
});

test("a session in use stays alive: extended (at most daily) and its cookie sent again", async () => {
  const cookie = await session();
  const { db, schema } = await import("../db/client");
  const { SESSION_TTL_S } = await import("./session");
  const now = () => Math.floor(Date.now() / 1000);
  // Fresh from login: no renewal yet.
  assert.equal((await get("/api/auth/me", cookie)).cookies.length, 0);
  // Twenty days later (ten left), using it extends it to a full month again.
  db.update(schema.sessions).set({ expiresAt: now() + 10 * 24 * 3600 }).run();
  const used = await get("/api/auth/me", cookie);
  assert.equal(used.json().authenticated, true);
  const renewed = used.cookies.find((c) => c.name === "mdb_session");
  assert.ok(renewed, "the cookie is sent again");
  assert.equal(renewed.maxAge, SESSION_TTL_S);
  const rows = db.select({ exp: schema.sessions.expiresAt }).from(schema.sessions).all();
  assert.ok(rows.some((r) => r.exp >= now() + SESSION_TTL_S - 5));
  assert.equal((await get("/api/auth/me", cookie)).cookies.length, 0, "not again the same day");
});

test("password change: checks current, enforces length, signs out other sessions", async () => {
  const mine = await session();
  const other = await session();
  const change = (currentPassword: string, newPassword: string) =>
    app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: mine, "cf-connecting-ip": newIp() },
      payload: { currentPassword, newPassword },
    });

  assert.equal((await change("wrong-pass", "a-long-new-password")).statusCode, 403);
  assert.equal((await change("initial-pass", "short")).statusCode, 400);
  assert.equal((await change("initial-pass", "a-long-new-password")).statusCode, 200);

  assert.equal((await get("/api/settings", mine)).statusCode, 200, "current session kept");
  assert.equal((await get("/api/settings", other)).statusCode, 401, "other session ended");
  assert.equal((await login("yamen", "initial-pass")).statusCode, 401);
  assert.equal((await login("yamen", "a-long-new-password")).statusCode, 200);

  // Restore for the remaining tests.
  assert.equal((await change("a-long-new-password", "initial-pass")).statusCode, 200);
});

test("per-IP limit: the 11th attempt within a minute from one IP gets 429", async () => {
  const ip = newIp();
  for (let i = 0; i < 10; i++) {
    // Different usernames so the per-username lockout isn't what triggers.
    assert.equal((await login(`guess${i}`, "x", ip)).statusCode, 401);
  }
  assert.equal((await login("yamen", "initial-pass", ip)).statusCode, 429);
});

test("per-username lockout: 10 failures from many IPs lock the account out", async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await login("yamen", `wrong-${i}`)).statusCode, 401);
  }
  // Even the right password is refused now, from a fresh IP.
  const locked = await login("yamen", "initial-pass");
  assert.equal(locked.statusCode, 429);
  assert.ok(Number(locked.headers["retry-after"]) > 0);
});
