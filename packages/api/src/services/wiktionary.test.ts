import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { FastifyInstance } from "fastify";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-wiktionary-"));
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
  ASSISTANT_API_KEY: "",
  DICTIONARY_API_URL: "",
});

const source = (w: string) => ({
  url: `https://en.wiktionary.org/wiki/${w}`,
  license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
});
// Shaped like the API's real answers (the "ging" one is verbatim from it).
const FIXTURES: Record<string, unknown> = {
  ging: {
    word: "ging",
    entries: [
      {
        language: { code: "de", name: "German" },
        partOfSpeech: "verb",
        pronunciations: [{ type: "ipa", text: "/ɡɪŋ/", tags: [] }],
        forms: [{ word: "gieng", tags: ["alternative"] }],
        senses: [
          {
            definition: "first/third-person singular preterite of gehen",
            tags: ["first person", "form of", "preterite", "singular", "third person"],
            examples: [], quotes: [], synonyms: [], antonyms: [], translations: [], subsenses: [],
          },
        ],
        synonyms: [], antonyms: [],
      },
    ],
    source: source("ging"),
  },
  gehen: {
    word: "gehen",
    entries: [
      {
        language: { code: "de", name: "German" },
        partOfSpeech: "verb",
        pronunciations: [{ type: "ipa", text: "/ˈɡeːən/", tags: [] }],
        forms: [],
        senses: [
          { definition: "to go, to walk", tags: ["intransitive"], examples: ["Ich gehe nach Hause. ― I'm going home."], quotes: [], synonyms: [], antonyms: [], subsenses: [] },
          { definition: "", tags: [], examples: [], quotes: [], synonyms: [], antonyms: [], subsenses: [
            { definition: "to work, to function", tags: [], examples: [], quotes: [], synonyms: [], antonyms: [], subsenses: [] },
          ] },
        ],
        synonyms: [], antonyms: [],
      },
      { language: { code: "en", name: "English" }, partOfSpeech: "noun", pronunciations: [], forms: [], senses: [{ definition: "not German", tags: [], examples: [], quotes: [], synonyms: [], antonyms: [], subsenses: [] }] },
    ],
    source: source("gehen"),
  },
};

const calls: string[] = [];
let failNext = false;

let app: FastifyInstance;
let cookie: string;
before(async () => {
  const { setTransportForTests } = await import("../assistant/egress");
  setTransportForTests(async (url) => {
    calls.push(url);
    if (failNext) {
      failNext = false;
      return new Response("busy", { status: 503 }) as never;
    }
    const word = decodeURIComponent(url.split("/entries/de/")[1]!);
    if (word === "riesig") return new Response("x".repeat(2 * 1024 * 1024)) as never;
    const body = FIXTURES[word];
    return (body
      ? new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ message: "not found" }), { status: 404 })) as never;
  });
  const { buildApp } = await import("../app");
  app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "yamen", password: "admin-password" } });
  cookie = `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`;
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  calls.length = 0;
});

const details = (word: string) =>
  app.inject({ method: "GET", url: `/api/dict/${encodeURIComponent(word)}/details`, headers: { cookie } });

test("a base form: German entries only, subsenses flattened, attribution kept", async () => {
  const res = await details("gehen");
  assert.equal(res.statusCode, 200);
  const d = res.json();
  assert.equal(d.word, "gehen");
  assert.equal(d.formOf, null);
  assert.equal(d.entries.length, 1, "the English entry is dropped");
  assert.equal(d.entries[0].ipa, "/ˈɡeːən/");
  assert.deepEqual(d.entries[0].senses.map((s: { definition: string }) => s.definition), ["to go, to walk", "to work, to function"]);
  assert.deepEqual(d.entries[0].senses[0].examples, ["Ich gehe nach Hause. ― I'm going home."]);
  assert.equal(d.source.license, "CC BY-SA 4.0");
  assert.deepEqual(calls, ["https://freedictionaryapi.com/api/v1/entries/de/gehen"]);
});

test("an inflected form: looked up via the offline base form, then cached", async () => {
  const d = (await details("ging")).json();
  assert.equal(d.word, "gehen");
  // The offline dictionary already knows ging → gehen, so the API is asked for
  // "gehen" — which is cached from the test above.
  assert.deepEqual(calls, []);
  assert.equal(d.entries[0].senses[0].definition, "to go, to walk");
});

test("the API's 'form of' sense is followed one hop when offline doesn't know the word", async () => {
  const { wordDetails } = await import("./wiktionary");
  const d = await wordDetails(["ging"]);
  assert.equal(d!.word, "gehen");
  assert.equal(d!.formOf, "first/third-person singular preterite of gehen");
  assert.deepEqual(calls, ["https://freedictionaryapi.com/api/v1/entries/de/ging"]);
});

test("not found is cached; errors and oversized answers aren't, and yield null", async () => {
  assert.equal((await details("xyzzyq")).json(), null);
  assert.equal((await details("xyzzyq")).json(), null);
  assert.equal(calls.length, 1, "the 404 is cached");

  calls.length = 0;
  failNext = true;
  const { wordDetails } = await import("./wiktionary");
  assert.equal(await wordDetails(["Baum"]), null);
  assert.equal(await wordDetails(["Baum"]), null);
  assert.equal(calls.length, 2, "a 503 isn't cached");

  assert.equal(await wordDetails(["riesig"]), null);
  const { db, schema } = await import("../db/client");
  const { eq } = await import("drizzle-orm");
  assert.equal(db.select().from(schema.dictCache).where(eq(schema.dictCache.word, "riesig")).get(), undefined);
});

test("signed-in only", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/dict/gehen/details" })).statusCode, 401);
});
