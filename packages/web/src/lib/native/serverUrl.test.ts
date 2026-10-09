import assert from "node:assert/strict";
import { test } from "node:test";
import { isLanHost, normalizeServerUrl, versionProblem } from "./serverUrl";

test("adds https:// and keeps only the origin", () => {
  assert.deepEqual(normalizeServerUrl(" wortschritt.example.com ", false), {
    ok: true,
    origin: "https://wortschritt.example.com",
  });
  assert.deepEqual(normalizeServerUrl("https://example.com:8443/", false), {
    ok: true,
    origin: "https://example.com:8443",
  });
});

test("rejects paths, credentials, other schemes and junk", () => {
  for (const bad of ["", "https://example.com/app", "https://a:b@example.com", "ftp://example.com", "https://exa mple.com", "https://example.com/?x=1"]) {
    assert.equal(normalizeServerUrl(bad, true).ok, false, bad);
  }
});

test("plain http only for LAN hosts, and only when allowed", () => {
  assert.equal(normalizeServerUrl("http://192.168.50.10:3000", false).ok, false);
  assert.deepEqual(normalizeServerUrl("http://192.168.50.10:3000", true), {
    ok: true,
    origin: "http://192.168.50.10:3000",
  });
  assert.equal(normalizeServerUrl("http://example.com", true).ok, false);
  assert.equal(normalizeServerUrl("http://8.8.8.8", true).ok, false);
});

test("isLanHost", () => {
  for (const h of ["10.0.0.1", "172.16.0.1", "172.31.255.1", "192.168.1.1", "127.0.0.1", "localhost", "ha", "nas.local", "pve.lan", "box.home.arpa", "[fd12:3456::1]", "[::1]"]) {
    assert.equal(isLanHost(h), true, h);
  }
  for (const h of ["172.32.0.1", "8.8.8.8", "example.com", "192.169.1.1", "[2001:db8::1]"]) {
    assert.equal(isLanHost(h), false, h);
  }
});

test("versionProblem compares minClient with the app's version", () => {
  assert.equal(versionProblem({ api: 1, minClient: 1, appName: "Wortschritt" }), null);
  assert.match(versionProblem({ api: 2, minClient: 2, appName: "Wortschritt" }) ?? "", /newer version/);
});
