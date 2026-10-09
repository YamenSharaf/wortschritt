import assert from "node:assert/strict";
import { test } from "node:test";
import { createApi } from "./api";
import type { FetchLike, ResponseLike } from "./http";
import { createTokenSession, OAuthError, type OAuthTokens } from "./oauth";
import { memoryStore } from "./storage";

const nowS = () => Math.floor(Date.now() / 1000);
const pair = (n: number, expiresIn = 3600): OAuthTokens => ({
  accessToken: `at${n}`,
  refreshToken: `rt${n}`,
  expiresAt: nowS() + expiresIn,
});

test("token session: one refresh for many callers when the token is about to run out", async () => {
  const store = memoryStore();
  let calls = 0;
  const session = createTokenSession({
    store,
    refresh: async (rt) => {
      calls++;
      assert.equal(rt, "rt1");
      await new Promise((r) => setTimeout(r, 20));
      return pair(2);
    },
  });
  await session.signIn(pair(1, 30)); // inside the 60 s leeway
  const tokens = await Promise.all([session.accessToken(), session.accessToken(), session.accessToken()]);
  assert.deepEqual(tokens, ["at2", "at2", "at2"]);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(String(await store.get("mdb-tokens"))).refreshToken, "rt2", "the new pair is kept");
});

test("token session: a rejected refresh signs out; being offline doesn't", async () => {
  let fail: Error = new TypeError("Network request failed");
  let signedOut = 0;
  const session = createTokenSession({
    store: memoryStore(),
    refresh: async () => {
      throw fail;
    },
    onSignedOut: () => void signedOut++,
  });
  await session.signIn(pair(1, 0));
  assert.equal(await session.refreshNow(), false);
  assert.ok(session.current(), "offline: still signed in");
  fail = new OAuthError("invalid_grant", "the refresh token was already used");
  assert.equal(await session.refreshNow(), false);
  assert.equal(session.current(), null);
  assert.equal(await session.accessToken(), null);
  assert.equal(signedOut, 1);
});

test("a token session survives a restart (it's read back from the store)", async () => {
  const store = memoryStore();
  await createTokenSession({ store, refresh: async () => pair(9) }).signIn(pair(1));
  const later = createTokenSession({ store, refresh: async () => pair(9) });
  assert.equal(await later.accessToken(), "at1");
});

test("createApi: a 401 refreshes once and sends the request again", async () => {
  let token = "old";
  const seen: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    seen.push(init.headers!.authorization!);
    const ok = init.headers!.authorization === "Bearer new";
    return { ok, status: ok ? 200 : 401, statusText: "", body: null, json: async () => (ok ? { ok: true } : { error: "unauthenticated" }) } as ResponseLike;
  };
  let refreshes = 0;
  const api = createApi({
    fetch,
    headers: () => ({ authorization: `Bearer ${token}` }),
    onUnauthorized: async () => {
      refreshes++;
      token = "new";
      return true;
    },
  });
  assert.deepEqual(await api.markStoryRead("x"), { ok: true });
  assert.deepEqual(seen, ["Bearer old", "Bearer new"]);

  token = "revoked";
  const stuck = createApi({ fetch, headers: () => ({ authorization: `Bearer ${token}` }), onUnauthorized: async () => true });
  await assert.rejects(stuck.markStoryRead("x"), /unauthenticated/);
  assert.equal(seen.filter((h) => h === "Bearer revoked").length, 2, "retried once, not forever");
  assert.equal(refreshes, 1);
});
