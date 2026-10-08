import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import { EXAMPLE_SERIES, EXAMPLE_STORY } from "@mdb/shared";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-series-"));
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
  TTS_URL: "",
  ASSISTANT_API_KEY: "",
  DICTIONARY_API_URL: "off",
});

let app: FastifyInstance;
type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;
let me: (method: InjectOptions["method"], url: string, payload?: unknown) => Promise<Res>;
before(async () => {
  const { buildApp } = await import("../app");
  app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "yamen", password: "admin-password" } });
  const cookie = `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`;
  me = (method, url, payload) =>
    app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const SID = EXAMPLE_SERIES.id;
const chapter = (n: number, title: string) => ({
  story: { ...EXAMPLE_STORY, id: "ignored", title },
  summary: `Kapitel ${n}: ${title}.`,
});

test("create a series; a second create is refused; planned chapters come from the outline", async () => {
  const res = await me("POST", "/api/series", { series: EXAMPLE_SERIES });
  assert.equal(res.statusCode, 200, res.body);
  const v = res.json();
  assert.equal(v.total, 3);
  assert.equal(v.written, 0);
  assert.equal(v.continueId, null);
  assert.deepEqual(v.chapters.map((c: { title: string; storyId: null }) => [c.title, c.storyId]), [
    ["Der Umzug", null],
    ["Der erste Arbeitstag", null],
    ["Herr Petersen erzählt", null],
  ]);
  assert.equal((await me("POST", "/api/series", { series: EXAMPLE_SERIES })).statusCode, 409);
  assert.equal((await me("POST", "/api/series", { series: { ...EXAMPLE_SERIES, id: "Kein Slug" } })).statusCode, 400);
});

test("chapters can be written in any order; ids are derived", async () => {
  const third = await me("PUT", `/api/series/${SID}/chapters/3`, chapter(3, "Herr Petersen erzählt"));
  assert.equal(third.statusCode, 200, third.body);
  assert.equal(third.json().story.id, `${SID}-03`);
  assert.deepEqual(third.json().series, { id: SID, title: "Lena in Hamburg", chapter: 3, total: 3, prev: null, next: null });

  await me("PUT", `/api/series/${SID}/chapters/1`, chapter(1, "Der Umzug"));
  const one = (await me("GET", `/api/stories/${SID}-01`)).json();
  assert.deepEqual(one.series, { id: SID, title: "Lena in Hamburg", chapter: 1, total: 3, prev: null, next: `${SID}-03` });

  const v = (await me("GET", `/api/series/${SID}`)).json();
  assert.deepEqual(v.chapters.map((c: { storyId: string | null }) => c.storyId), [`${SID}-01`, null, `${SID}-03`]);
  assert.equal(v.chapters[0].summary, "Kapitel 1: Der Umzug.");
  assert.equal(v.continueId, `${SID}-01`);

  // Chapters are stories, marked with their book.
  const stories = (await me("GET", "/api/stories")).json() as { id: string; seriesId: string | null; chapter: number | null }[];
  assert.deepEqual(stories.find((s) => s.id === `${SID}-01`)!.seriesId, SID);
  assert.equal(stories.find((s) => s.id === `${SID}-03`)!.chapter, 3);

  // Beyond the outline: the book grows.
  await me("PUT", `/api/series/${SID}/chapters/4`, chapter(4, "Das Geheimnis"));
  assert.equal((await me("GET", `/api/series/${SID}`)).json().total, 4);
});

test("an existing chapter needs overwrite (progress kept); clashes and unknown series are refused", async () => {
  assert.equal((await me("PUT", `/api/series/${SID}/chapters/1`, chapter(1, "Neu"))).statusCode, 409);
  await me("PUT", `/api/stories/${SID}-01/progress`, { progress: 0.5 });
  const over = await me("PUT", `/api/series/${SID}/chapters/1`, { ...chapter(1, "Der Umzug (neu)"), overwrite: true });
  assert.equal(over.statusCode, 200);
  assert.equal(over.json().story.title, "Der Umzug (neu)");
  assert.equal(over.json().progress, 0.5);

  // A standalone story already using a chapter's id.
  await me("POST", "/api/stories", { story: { ...EXAMPLE_STORY, id: `${SID}-02` } });
  const clash = await me("PUT", `/api/series/${SID}/chapters/2`, chapter(2, "x"));
  assert.equal(clash.statusCode, 409);
  assert.match(clash.json().error, /outside this series/);
  await me("DELETE", `/api/stories/${SID}-02`);

  assert.equal((await me("PUT", "/api/series/nope/chapters/1", chapter(1, "x"))).statusCode, 404);
});

test("book progress and where to continue", async () => {
  await me("PUT", `/api/series/${SID}/chapters/2`, chapter(2, "Der erste Arbeitstag"));
  await me("PUT", `/api/stories/${SID}-01/progress`, { progress: 1, read: true });
  await me("PUT", `/api/stories/${SID}-02/progress`, { progress: 0.5 });
  const [summary] = (await me("GET", "/api/series")).json();
  assert.equal(summary.read, 1);
  assert.equal(summary.written, 4);
  assert.equal(summary.total, 4);
  assert.equal(summary.progress, (1 + 0.5) / 4);
  assert.equal(summary.continueId, `${SID}-02`);
});

test("overwriting the series keeps its chapters; deleting it deletes them", async () => {
  const res = await me("POST", "/api/series", {
    series: { ...EXAMPLE_SERIES, outline: [...EXAMPLE_SERIES.outline!, { title: "Das Geheimnis" }, { title: "Abschied" }] },
    overwrite: true,
  });
  assert.equal(res.json().total, 5);
  assert.equal(res.json().written, 4);

  await me("PUT", `/api/stories/${SID}-01/translations`, { paragraphs: [{ index: 0, lines: ["x"] }] });
  assert.equal((await me("DELETE", `/api/series/${SID}`)).statusCode, 200);
  assert.equal((await me("GET", `/api/stories/${SID}-01`)).statusCode, 404);
  assert.deepEqual((await me("GET", "/api/series")).json(), []);
  const { db, schema } = await import("../db/client");
  assert.equal(db.select().from(schema.stories).all().filter((s) => s.seriesId === SID).length, 0);
  assert.equal(db.select().from(schema.storyTranslations).all().length, 0, "chapter translations cascade");
  assert.equal((await me("DELETE", `/api/series/${SID}`)).statusCode, 404);
});
