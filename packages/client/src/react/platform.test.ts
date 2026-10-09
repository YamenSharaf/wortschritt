import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import TestRenderer from "react-test-renderer";
import { exerciseItem } from "@mdb/shared";
import type { Api } from "../api";
import { describeItem } from "../describeItem";
import { formChips } from "../forms";
import { memoryStore, preferences, type KeyValueStore } from "../storage";
import { timeAgo } from "../time";
import { ClientProvider } from "./context";
import { act, flush } from "./testing";
import { AuthProvider, useAuth } from "./useAuth";
import { usePreference } from "./usePreference";

/** Render `hook` under a ClientProvider with `storage` (and an AuthProvider). */
function render<T>(hook: () => T, { api = {}, storage }: { api?: Partial<Api>; storage?: KeyValueStore }) {
  let value: T;
  const Probe = () => {
    value = hook();
    return null;
  };
  let root!: TestRenderer.ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(
      createElement(ClientProvider, { api: api as Api, storage }, createElement(AuthProvider, null, createElement(Probe))),
    );
  });
  return { current: () => value, unmount: () => act(() => root.unmount()) };
}

const me = (user: unknown) => ({ authenticated: user !== null, user }) as never;

test("usePreference: reads at once, falls back on a bad value, writes changes", () => {
  const store = memoryStore();
  store.set(preferences.noteFontSize.key, "20");
  store.set(preferences.flashcardSide.key, "fr");
  const h = render(
    () => ({ size: usePreference(preferences.noteFontSize), side: usePreference(preferences.flashcardSide) }),
    { api: { me: async () => me(null) }, storage: store },
  );
  assert.equal(h.current().size[0], 20);
  assert.equal(h.current().side[0], "de", "an unknown side reads as the default");
  act(() => h.current().size[1]((s) => s + 1));
  assert.equal(h.current().size[0], 21);
  assert.equal(store.get(preferences.noteFontSize.key), "21");
  h.unmount();
});

test("usePreference: an async store answers after the first render", async () => {
  const store: KeyValueStore = { get: async () => "list", set: async () => {} };
  const h = render(() => usePreference(preferences.shelfView), { api: { me: async () => me(null) }, storage: store });
  assert.equal(h.current()[0], "covers");
  await flush();
  assert.equal(h.current()[0], "list");
  h.unmount();
});

test("useAuth: asks the server on start, then follows login and logout", async () => {
  let signedIn = false;
  const user = { id: 1, username: "yamen", role: "admin" };
  const api: Partial<Api> = {
    me: async () => me(signedIn ? user : null),
    login: async () => {
      signedIn = true;
      return { ok: true };
    },
    logout: async () => {
      signedIn = false;
      return { ok: true };
    },
  };
  const h = render(() => useAuth(), { api });
  assert.equal(h.current().loading, true);
  await flush();
  assert.equal(h.current().loading, false);
  assert.equal(h.current().authenticated, false);
  await act(() => h.current().login("yamen", "pw"));
  assert.deepEqual(h.current().user, user);
  await act(() => h.current().logout());
  assert.equal(h.current().user, null);
  h.unmount();
});

test("plain helpers: timeAgo, formChips, describeItem keeps the answer out of the label", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(timeAgo(now - 10), "just now");
  assert.equal(timeAgo(now - 3 * 3600), "3h ago");
  assert.deepEqual(formChips({ pos: "verb", partizip2: "gegangen", auxiliary: "sein" } as never), [["Perfekt", "ist gegangen"]]);
  assert.deepEqual(formChips({ pos: "noun", article: "der", plural: "Bäume" } as never), [["Artikel", "der"], ["Plural", "Bäume"]]);

  const cloze = exerciseItem.parse({ id: "c", type: "cloze", text: "Ich {{1}} müde.", blanks: [{ ref: "1", answer: { accept: ["bin"] } }] });
  const d = describeItem(cloze);
  assert.ok(!/\bbin\b/.test(d.label), d.label);
  assert.deepEqual(d.expected, ["bin"]);
});
