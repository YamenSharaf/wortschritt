import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { authorizeUrl, parseCallback, pkcePair, REDIRECT_URI, toStoredTokens } from "./oauth";

test("pkcePair: S256 challenge of a 43-char verifier", async () => {
  const { verifier, challenge } = await pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  assert.notEqual((await pkcePair()).verifier, verifier);
});

test("authorizeUrl asks for the app scope with PKCE", () => {
  const u = new URL(authorizeUrl("https://w.example.com", { clientId: "c1", challenge: "ch", state: "st" }));
  assert.equal(u.origin + u.pathname, "https://w.example.com/oauth/authorize");
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    response_type: "code",
    client_id: "c1",
    redirect_uri: REDIRECT_URI,
    code_challenge: "ch",
    code_challenge_method: "S256",
    state: "st",
    scope: "app",
  });
});

test("parseCallback", () => {
  const cb = (q: string) => `${REDIRECT_URI}?${q}`;
  assert.deepEqual(parseCallback(cb("code=abc&state=s1"), "s1"), { ok: true, code: "abc" });
  assert.equal(parseCallback("https://example.com/oauth/callback?code=x&state=s1", "s1"), null, "not ours");
  assert.equal(parseCallback("eu.yamen.wortschritt:/other?code=x", "s1"), null, "other path");
  assert.equal(parseCallback(cb("code=abc&state=evil"), "s1")?.ok, false, "state mismatch");
  assert.equal(parseCallback(cb("code=abc&state=s1"), null)?.ok, false, "nothing pending");
  assert.deepEqual(parseCallback(cb("error=access_denied&state=s1"), "s1"), { ok: false, error: "Sign-in was cancelled." });
  assert.equal(parseCallback(cb("state=s1"), "s1")?.ok, false, "no code");
});

test("toStoredTokens expires a minute early and rejects junk", () => {
  const t = toStoredTokens("c1", { access_token: "a", refresh_token: "r", expires_in: 3600 }, 1000);
  assert.deepEqual(t, { clientId: "c1", accessToken: "a", refreshToken: "r", expiresAt: 1000 + 3540 * 1000 });
  assert.equal(toStoredTokens("c1", { error: "invalid_grant" }), null);
  assert.equal(toStoredTokens("c1", null), null);
});
