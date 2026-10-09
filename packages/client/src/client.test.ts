import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApiError,
  chunkText,
  createApi,
  createSpeech,
  createSseParser,
  pickVoice,
  type FetchLike,
  type RequestInitLike,
  type ResponseLike,
} from "./index";

const json = (status: number, body: unknown): ResponseLike => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: "Status",
  json: async () => body,
  body: null,
});

function recorder(res: () => ResponseLike) {
  const calls: { url: string; init: RequestInitLike }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return res();
  };
  return { calls, fetch };
}

test("requests go to the base URL with the auth headers; JSON only with a body", async () => {
  const { calls, fetch } = recorder(() => json(200, { ok: true }));
  const api = createApi({ baseUrl: "https://wort.example/", fetch, headers: async () => ({ authorization: "Bearer t" }) });
  await api.markStoryRead("a b");
  await api.login("me", "pw");
  assert.equal(calls[0]!.url, "https://wort.example/api/stories/a%20b/read");
  assert.deepEqual(calls[0]!.init.headers, { authorization: "Bearer t" });
  assert.equal(calls[1]!.init.headers!["content-type"], "application/json");
  assert.equal(calls[1]!.init.body, JSON.stringify({ username: "me", password: "pw" }));
  assert.equal(api.ttsUrl("de-DE-X", "Guten Tag"), "https://wort.example/api/tts?voice=de-DE-X&text=Guten%20Tag");
  assert.equal(api.coverUrl("series", "s1", "g-1"), "https://wort.example/api/series/s1/cover.svg?v=g-1");
});

test("errors carry the server's message; 401 is unauthenticated; 204 is undefined", async () => {
  let next = json(409, { error: "taken" });
  const api = createApi({ fetch: async () => next });
  await assert.rejects(api.register("me", "pw"), (e) => e instanceof ApiError && e.status === 409 && e.message === "taken");
  next = json(401, { error: "whatever" });
  await assert.rejects(api.me(), (e) => e instanceof ApiError && e.message === "unauthenticated");
  next = json(204, null);
  assert.equal(await api.logout(), undefined);
});

test("the SSE parser handles split chunks, skips junk, stops at [DONE] and throws errors", () => {
  const seen: unknown[] = [];
  const feed = createSseParser((e) => seen.push(e));
  assert.equal(feed('data: {"token":"Hal'), false);
  assert.equal(feed('lo"}\n\n: comment\ndata: nope\n'), false);
  assert.equal(feed('data: {"token":"!"}\ndata: [DONE]\ndata: {"token":"late"}\n'), true);
  assert.deepEqual(seen, [{ token: "Hallo" }, { token: "!" }]);
  assert.throws(() => createSseParser(() => {})('data: {"error":"no key"}\n'), /no key/);
});

test("askAssistant streams tokens from a byte stream", async () => {
  const enc = new TextEncoder();
  const chunks = ['data: {"token":"Gu', 'ten"}\ndata: {"token":" Tag"}\n', "data: [DONE]\n"].map((c) => enc.encode(c));
  const api = createApi({
    fetch: async () => ({
      ...json(200, null),
      body: { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }) }) },
    }),
  });
  let text = "";
  await api.askAssistant({ task: "chat" }, (t) => (text += t));
  assert.equal(text, "Guten Tag");
});

test("chunkText splits at sentence ends and hard-splits overlong sentences", () => {
  assert.deepEqual(chunkText("Eins. Zwei!  Drei?", 12), ["Eins. Zwei!", "Drei?"]);
  assert.deepEqual(chunkText("a".repeat(10), 4), ["aaaa", "aaaa", "aa"]);
});

test("pickVoice prefers a natural voice, then a cloud one, then any match", () => {
  const v = (name: string, lang: string, localService = true) => ({ name, lang, localService });
  assert.equal(pickVoice([v("Anna", "de-DE"), v("Katja Natural", "de-DE")], "de-DE")?.name, "Katja Natural");
  assert.equal(pickVoice([v("Anna", "de-DE"), v("Google", "de-DE", false)], "de-DE")?.name, "Google");
  assert.equal(pickVoice([v("Sam", "en-US")], "de-DE"), undefined);
});

test("speakSequence reads by server clip, falls back to the device, and reports progress", async () => {
  const log: string[] = [];
  const speech = createSpeech({
    clipUrl: (voice, text) => `${voice}:${text}`,
    device: {
      supported: () => true,
      speak: async (text) => void log.push(`device ${text}`),
      stop: () => {},
    },
    clips: {
      play: async (url) => {
        if (url.includes("Zwei")) throw new Error("clip failed");
        log.push(`clip ${url}`);
      },
      stop: () => {},
      prefetch: async (url) => void log.push(`prefetch ${url}`),
    },
  });
  speech.setServerTts({ enabled: true, voice: "v" });
  const indexes: number[] = [];
  await new Promise<void>((done) => speech.speakSequence(["Eins.", "Zwei."], { onIndex: (i) => indexes.push(i), onEnd: done }));
  assert.deepEqual(indexes, [0, 1]);
  assert.deepEqual(log, ["prefetch v:Zwei.", "clip v:Eins.", "device Zwei."]);
});
