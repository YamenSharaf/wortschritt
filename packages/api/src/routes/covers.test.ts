import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import { unzipSync } from "fflate";
import { checkCoverSvg, EXAMPLE_SERIES, EXAMPLE_STORY, fallbackCover } from "@mdb/shared";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-covers-"));
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
type Client = (method: InjectOptions["method"], url: string, payload?: unknown) => Promise<Res>;
async function login(username: string, password: string): Promise<Client> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  const cookie = `mdb_session=${res.cookies.find((c) => c.name === "mdb_session")!.value}`;
  return (method, url, payload) =>
    app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
}
let me: Client;
before(async () => {
  const { buildApp } = await import("../app");
  app = await buildApp();
  me = await login("yamen", "admin-password");
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const ART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900">
<defs><linearGradient id="g"><stop offset="0" stop-color="#111"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
<rect width="600" height="900" fill="#fff"/>
<circle cx="300" cy="300" r="120" fill="url(#g)"/>
<text x="300" y="640" text-anchor="middle" font-family="serif" font-size="54">Der Umzug &amp; mehr</text>
</svg>`;

test("checkCoverSvg: shapes and text pass; scripts, links, styles and images don't", () => {
  assert.deepEqual(checkCoverSvg(ART), []);
  assert.deepEqual(checkCoverSvg(fallbackCover({ seed: "x", title: "Ein sehr langer Titel für ein kleines Buch", subtitle: "A <test>", level: "A2", label: "Kapitel 1" })), []);
  const bad = (svg: string, re: RegExp) => assert.ok(checkCoverSvg(svg).some((p) => re.test(p)), `${svg}: ${checkCoverSvg(svg)}`);
  const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900">${inner}</svg>`;
  bad(wrap(`<script>alert(1)</script>`), /<script>/);
  bad(wrap(`<foreignObject><div/></foreignObject>`), /<foreignObject>/);
  bad(wrap(`<image href="https://example.com/x.png"/>`), /<image>/);
  bad(wrap(`<style>rect{fill:red}</style>`), /<style>/);
  bad(wrap(`<a href="https://example.com"><rect/></a>`), /<a>/);
  bad(wrap(`<rect onclick="alert(1)"/>`), /event attributes/);
  bad(wrap(`<use href="https://example.com/s.svg#x"/>`), /may only point inside/);
  bad(wrap(`<use xlink:href="&#106;avascript:alert(1)"/>`), /character references|may only point inside/);
  bad(wrap(`<rect fill="url(https://example.com/x)"/>`), /url\(\)/);
  bad(wrap(`<rect style="background:url(data:x)"/>`), /url\(\)|disallowed/);
  bad(`<!DOCTYPE svg [<!ENTITY x "y">]>${wrap("")}`, /single <svg>|DOCTYPE/);
  bad(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`, /viewBox/);
  bad(`<div>${wrap("")}</div>`, /single <svg>/);
});

test("a series and its chapters get generated covers, and can be given art", async () => {
  await me("POST", "/api/series", { series: EXAMPLE_SERIES });
  await me("PUT", `/api/series/${EXAMPLE_SERIES.id}/chapters/1`, { story: EXAMPLE_STORY, summary: "s" });
  const ch = `${EXAMPLE_SERIES.id}-01`;

  // No art yet: a generated cover with the title.
  let view = (await me("GET", `/api/series/${EXAMPLE_SERIES.id}`)).json();
  assert.equal(view.cover, null);
  assert.equal(view.chapters[0].cover, null);
  const gen = await me("GET", `/api/series/${EXAMPLE_SERIES.id}/cover.svg`);
  assert.equal(gen.statusCode, 200);
  assert.match(String(gen.headers["content-type"]), /^image\/svg\+xml/);
  assert.match(String(gen.headers["content-security-policy"]), /default-src 'none'/);
  assert.match(gen.body, new RegExp(EXAMPLE_SERIES.title.split(" ")[0]!));
  assert.match((await me("GET", `/api/stories/${ch}/cover.svg`)).body, /KAPITEL 1/);

  // Drawn art: stored, versioned, served as is.
  const set = await me("PUT", `/api/series/${EXAMPLE_SERIES.id}/cover`, { svg: ART });
  assert.equal(set.statusCode, 200, set.body);
  assert.match(set.json().cover, /^[0-9a-f]{12}$/);
  assert.equal((await me("PUT", `/api/stories/${ch}/cover`, { svg: ART })).statusCode, 200);
  view = (await me("GET", `/api/series/${EXAMPLE_SERIES.id}`)).json();
  assert.equal(view.cover, set.json().cover);
  assert.equal(view.chapters[0].cover, set.json().cover);
  assert.equal((await me("GET", "/api/series")).json()[0].cover, set.json().cover);
  assert.equal((await me("GET", "/api/stories")).json().find((s: { id: string }) => s.id === ch).cover, set.json().cover);
  assert.equal((await me("GET", `/api/series/${EXAMPLE_SERIES.id}/cover.svg`)).body, ART);

  // Re-saving the chapter's text keeps its cover.
  await me("PUT", `/api/series/${EXAMPLE_SERIES.id}/chapters/1`, { story: { ...EXAMPLE_STORY, title: "Neu" }, summary: "s", overwrite: true });
  assert.equal((await me("GET", `/api/stories/${ch}/cover.svg`)).body, ART);

  // Unsafe art is refused; null removes the art.
  const bad = await me("PUT", `/api/series/${EXAMPLE_SERIES.id}/cover`, { svg: ART.replace("<rect", "<script>x</script><rect") });
  assert.equal(bad.statusCode, 400);
  assert.equal((await me("PUT", `/api/stories/nope/cover`, { svg: ART })).statusCode, 404);
});

test("the EPUB gets a PNG cover (and the chapter's art)", async () => {
  const res = await me("GET", `/api/series/${EXAMPLE_SERIES.id}/epub`);
  assert.equal(res.statusCode, 200);
  const files = unzipSync(new Uint8Array(res.rawPayload));
  const png = files["OEBPS/cover.png"]!;
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "a PNG");
  assert.equal(Buffer.from(png).readUInt32BE(16), 1200, "1200px wide");
  const opf = Buffer.from(files["OEBPS/content.opf"]!).toString();
  assert.match(opf, /<item id="cover-image" href="cover.png" media-type="image\/png" properties="cover-image"\/>/);
  assert.match(opf, /<meta name="cover" content="cover-image"\/>/);
  assert.match(opf, /<itemref idref="cover" linear="yes"\/>\s*<itemref idref="title"\/>/);
  assert.ok(files["OEBPS/images/chapter-01.png"], "drawn chapter art is included");
  assert.match(Buffer.from(files["OEBPS/chapter-01.xhtml"]!).toString(), /<img src="images\/chapter-01.png"/);

  // A story without art still gets a (generated) cover.
  await me("POST", "/api/stories", { story: EXAMPLE_STORY });
  const story = unzipSync(new Uint8Array((await me("GET", `/api/stories/${EXAMPLE_STORY.id}/epub`)).rawPayload));
  assert.ok(story["OEBPS/cover.png"]);
});

test("private: another user can't see or change covers", async () => {
  await me("PUT", "/api/admin/registration", { open: true });
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "anna", password: "anna-password" } });
  const anna = await login("anna", "anna-password");
  assert.equal((await anna("GET", `/api/series/${EXAMPLE_SERIES.id}/cover.svg`)).statusCode, 404);
  assert.equal((await anna("PUT", `/api/series/${EXAMPLE_SERIES.id}/cover`, { svg: null })).statusCode, 404);
  assert.equal((await anna("GET", `/api/stories/${EXAMPLE_STORY.id}/cover.svg`)).statusCode, 404);
  assert.equal((await me("GET", `/api/series/${EXAMPLE_SERIES.id}/cover.svg`)).body, ART, "unchanged");
  assert.equal((await app.inject({ method: "GET", url: `/api/series/${EXAMPLE_SERIES.id}/cover.svg` })).statusCode, 401);
});
