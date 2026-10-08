import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import { XMLValidator } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { EXAMPLE_SERIES, EXAMPLE_STORY } from "@mdb/shared";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-epub-"));
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

/** Open an EPUB and check the container rules e-readers rely on. */
function openEpub(res: Res) {
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["content-type"], "application/epub+zip");
  const raw = res.rawPayload;
  // First local file header: "mimetype", stored (method 0), no extra field.
  assert.equal(raw.readUInt32LE(0), 0x04034b50);
  assert.equal(raw.readUInt16LE(8), 0, "mimetype is stored, not compressed");
  const nameLen = raw.readUInt16LE(26);
  const extraLen = raw.readUInt16LE(28);
  assert.equal(raw.subarray(30, 30 + nameLen).toString(), "mimetype");
  assert.equal(raw.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + 20).toString(), "application/epub+zip");

  const files = Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(raw))).map(([k, v]) => [k, strFromU8(v)]),
  );
  for (const [name, text] of Object.entries(files)) {
    if (/\.(xhtml|opf|ncx|xml)$/.test(name)) {
      const ok = XMLValidator.validate(text);
      assert.equal(ok, true, `${name}: ${JSON.stringify(ok)}`);
    }
  }
  assert.match(files["META-INF/container.xml"]!, /full-path="OEBPS\/content.opf"/);
  const opf = files["OEBPS/content.opf"]!;
  for (const [, href] of opf.matchAll(/href="([^"]+)"/g)) {
    assert.ok(files[`OEBPS/${href}`] !== undefined, `manifest item ${href} exists`);
  }
  assert.match(opf, /<dc:language>de<\/dc:language>/);
  assert.match(opf, /<meta property="dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/meta>/);
  assert.match(opf, /properties="nav"/);
  return files;
}

test("a story: German text, glossary at the end; no questions or translations", async () => {
  await me("POST", "/api/stories", { story: EXAMPLE_STORY });
  await me("PUT", `/api/stories/${EXAMPLE_STORY.id}/translations`, {
    paragraphs: [{ index: 0, lines: ["On Sunday Lena got up early.", "The sun was shining."] }],
  });
  const res = await me("GET", `/api/stories/${EXAMPLE_STORY.id}/epub`);
  assert.match(String(res.headers["content-disposition"]), /attachment; filename="ein-sonntag-am-see.epub"/);
  const files = openEpub(res);
  const ch = files["OEBPS/chapter-01.xhtml"]!;
  assert.match(ch, /xml:lang="de"/);
  assert.match(ch, /<strong>aufgestanden<\/strong>/, "Markdown rendered");
  assert.match(ch, /<p>Sie hat ihre Freundin Mia angerufen/);
  assert.match(ch, /epub:type="glossary"/);
  assert.match(ch, /<dt>der See<\/dt>\s*<dd class="" xml:lang="en" lang="en">the lake<\/dd>|<dt>der See<\/dt>\s*<dd xml:lang="en" lang="en">the lake<\/dd>/);
  assert.doesNotMatch(ch, /On Sunday Lena/, "no translations");
  assert.doesNotMatch(ch, /Was haben Lena und Mia am See gemacht/, "no questions");
  assert.match(files["OEBPS/title.xhtml"]!, /Ein Sonntag am See/);

  // Same story, same book id (a device recognises the re-export).
  const again = openEpub(await me("GET", `/api/stories/${EXAMPLE_STORY.id}/epub`));
  const id = (opf: string) => opf.match(/urn:uuid:[0-9a-f-]+/)![0];
  assert.equal(id(again["OEBPS/content.opf"]!), id(files["OEBPS/content.opf"]!));
});

test("a series: written chapters in order with a table of contents; planned ones left out", async () => {
  const sid = EXAMPLE_SERIES.id;
  await me("POST", "/api/series", { series: EXAMPLE_SERIES });
  assert.equal((await me("GET", `/api/series/${sid}/epub`)).statusCode, 409, "nothing written yet");
  await me("PUT", `/api/series/${sid}/chapters/3`, { story: { ...EXAMPLE_STORY, title: "Herr Petersen erzählt" }, summary: "s" });
  await me("PUT", `/api/series/${sid}/chapters/1`, {
    story: { ...EXAMPLE_STORY, title: "Der Umzug", body: "Lena & Mia ziehen um. <3\n\n## Neue Nachbarn\n\n![Bild](https://example.com/x.png) Es ist laut." },
    summary: "s",
  });
  const files = openEpub(await me("GET", `/api/series/${sid}/epub`));
  assert.deepEqual(Object.keys(files).filter((f) => f.startsWith("OEBPS/chapter-")).sort(), [
    "OEBPS/chapter-01.xhtml",
    "OEBPS/chapter-02.xhtml",
  ]);
  const nav = files["OEBPS/nav.xhtml"]!;
  assert.ok(nav.indexOf("Kapitel 1: Der Umzug") < nav.indexOf("Kapitel 3: Herr Petersen erzählt"));
  assert.doesNotMatch(nav, /Der erste Arbeitstag/, "the unwritten chapter 2 isn't there");
  const ch1 = files["OEBPS/chapter-01.xhtml"]!;
  assert.match(ch1, /Lena &amp; Mia ziehen um\. &lt;3/, "escaped");
  assert.match(ch1, /<h2>Neue Nachbarn<\/h2>/);
  assert.doesNotMatch(ch1, /<img/, "remote images are dropped");
  assert.match(files["OEBPS/toc.ncx"]!, /<navPoint id="np-2" playOrder="2"><navLabel><text>Kapitel 3: Herr Petersen erzählt/);
  assert.match(files["OEBPS/title.xhtml"]!, /Lena zieht für ein Praktikum nach Hamburg/);
});

test("private: another user can't download them", async () => {
  await me("PUT", "/api/admin/registration", { open: true });
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "anna", password: "anna-password" } });
  const anna = await login("anna", "anna-password");
  assert.equal((await anna("GET", `/api/stories/${EXAMPLE_STORY.id}/epub`)).statusCode, 404);
  assert.equal((await anna("GET", `/api/series/${EXAMPLE_SERIES.id}/epub`)).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/api/stories/${EXAMPLE_STORY.id}/epub` })).statusCode, 401);
});
