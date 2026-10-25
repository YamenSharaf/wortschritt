import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";

// See auth.test.ts: configure a throwaway database before importing the app.
const dir = mkdtempSync(join(tmpdir(), "mdb-tts-"));
Object.assign(process.env, {
  APP_PASSWORD: "admin-password",
  SESSION_SECRET: "test-session-secret",
  ADMIN_USERNAME: "yamen",
  DATABASE_PATH: join(dir, "app.db"),
  CONTENT_DIR: resolve(import.meta.dirname, "../../../../content"),
  NODE_ENV: "test",
  ASSISTANT_API_KEY: "",
  DICTIONARY_API_URL: "off",
  ENCRYPTION_KEY: "test-encryption-key-that-is-long-enough",
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

// Calls to Azure go through the egress guard's transport; record them.
const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
/** What "Azure" sends back (tests can swap it). */
let azureAudio = (_body: string): Uint8Array => new Uint8Array([0xff, 0xf3, 1, 2, 3]);
/** The voices "Azure" says its region has. */
let regionVoiceNames = ["de-DE-KatjaNeural", "de-DE-ConradNeural", "de-DE-Seraphina:DragonHDLatestNeural", "de-DE-Florian:DragonHDLatestNeural"];
/** What "Gemini" answers (tests swap it): by default a second of quiet PCM. */
const defaultGemini = (): Response =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(48_000).toString("base64") } }] } }] }), { status: 200 });
let geminiReply = defaultGemini;
/** As if Google's day had turned: every entry's limit and count start afresh. */
async function newGoogleDay() {
  const { db, schema } = await import("../db/client");
  db.update(schema.ttsEntries).set({ limitedUntil: null, limitReason: null }).run();
  db.delete(schema.ttsUsage).run();
}
before(async () => {
  const { buildApp } = await import("../app");
  const { setTransportForTests } = await import("../assistant/egress");
  setTransportForTests(async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    if (url.startsWith("https://generativelanguage.googleapis.com/")) return geminiReply() as never;
    if (url.endsWith("/voices/list")) return new Response(JSON.stringify(regionVoiceNames.map((ShortName) => ({ ShortName }))), { status: 200 }) as never;
    try {
      return new Response(azureAudio(String(init.body)), { status: 200, headers: { "content-type": "audio/mpeg" } }) as never;
    } catch (e) {
      return new Response("", { status: (e as { status?: number }).status ?? 500 }) as never;
    }
  });
  app = await buildApp();
  me = await login("yamen", "admin-password");
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const tts = (voice: string, text: string) => me("GET", `/api/tts?${new URLSearchParams({ voice, text })}`);

test("no providers: no server voices, and cloud voices are refused", async () => {
  const status = (await me("GET", "/api/tts/status")).json();
  assert.equal(status.available, false);
  assert.deepEqual(status.voices, []);
  assert.equal((await tts("azure:de-DE-KatjaNeural", "Hallo")).statusCode, 503);
  assert.equal((await tts("edge:de-DE-KatjaNeural", "Hallo")).statusCode, 503);
  assert.deepEqual((await me("GET", "/api/admin/tts")).json(), {
    azure: { configured: false, region: "", canStoreKey: true },
    edge: { enabled: false },
    gemini: { keys: [], entries: [] },
    share: "all",
    edgeFallback: false,
  });
});

test("Azure: the admin stores a key; voices appear; synthesis is SSML to the region, escaped, cached", async () => {
  assert.equal((await me("PUT", "/api/admin/tts", { azure: { region: "westeurope" } })).statusCode, 400, "a key is needed");
  assert.equal((await me("PUT", "/api/admin/tts", { azure: { region: "evil.example.com/x", key: "k".repeat(32) } })).statusCode, 400);
  const set = await me("PUT", "/api/admin/tts", { azure: { region: "westeurope", key: "secret-azure-key-123" } });
  assert.equal(set.statusCode, 200, set.body);
  assert.equal(set.json().azure.configured, true);
  assert.ok(!set.body.includes("secret-azure-key"), "the key is never sent back");

  const status = (await me("GET", "/api/tts/status")).json();
  assert.equal(status.available, true);
  assert.ok(status.voices.some((v: { id: string; provider: string }) => v.id === "azure:de-DE-KatjaNeural" && v.provider === "azure"));
  assert.ok(status.voices.some((v: { id: string }) => v.id === "azure:de-DE-Seraphina:DragonHDLatestNeural"), "and Azure's HD voices");
  assert.ok(calls.some((c) => c.url.endsWith("/voices/list")), "after asking the region which it has");
  calls.length = 0;

  const res = await tts("azure:de-DE-KatjaNeural", "Tom & Jerry <sagen> „Hallo“");
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["content-type"], "audio/mpeg");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(calls[0]!.headers["Ocp-Apim-Subscription-Key"], "secret-azure-key-123");
  assert.match(calls[0]!.body, /<voice name='de-DE-KatjaNeural'>Tom &amp; Jerry &lt;sagen&gt; „Hallo“<\/voice>/);
  assert.equal((await tts("azure:de-DE-KatjaNeural", "Tom & Jerry <sagen> „Hallo“")).statusCode, 200);
  assert.equal(calls.length, 1, "served from the cache");

  assert.equal((await tts("azure:de-DE-NotAVoice", "Hallo")).statusCode, 503, "only known voices");
  assert.equal((await tts("azure:de-DE-Florian:DragonHDLatestNeural", "Hallo")).statusCode, 200, "an HD voice");
  assert.match(calls.at(-1)!.body, /xml:lang='de-DE'><voice name='de-DE-Florian:DragonHDLatestNeural'>Hallo</);
  // Changing the region keeps the stored key.
  assert.equal((await me("PUT", "/api/admin/tts", { azure: { region: "germanywestcentral" } })).statusCode, 200);
  await me("POST", "/api/admin/tts/test", { voice: "azure:de-DE-ConradNeural" });
  assert.equal(calls.at(-1)!.url, "https://germanywestcentral.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(calls.at(-1)!.headers["Ocp-Apim-Subscription-Key"], "secret-azure-key-123");
});

test("Edge voices are opt-in", async () => {
  assert.ok(!(await me("GET", "/api/tts/status")).json().voices.some((v: { provider: string }) => v.provider === "edge"));
  assert.equal((await me("PUT", "/api/admin/tts", { edge: true })).json().edge.enabled, true);
  assert.ok((await me("GET", "/api/tts/status")).json().installed.includes("edge:de-DE-SeraphinaMultilingualNeural"));
  assert.equal((await tts("edge:de-DE-Florian:DragonHDLatestNeural", "Hallo")).statusCode, 503, "HD voices are Azure's only");
  await me("PUT", "/api/admin/tts", { edge: false });
});

test("the Edge protocol helpers: token and audio frames", async () => {
  const { audioFromFrame, secMsGec } = await import("../tts/edge");
  const t = Date.UTC(2026, 9, 8, 12, 0, 0);
  assert.match(secMsGec(t), /^[0-9A-F]{64}$/);
  assert.equal(secMsGec(t), secMsGec(t + 299_000), "stable within the 5-minute window");
  assert.notEqual(secMsGec(t), secMsGec(t + 300_000));
  const frame = (header: string, data: number[]) => {
    const h = Buffer.from(header);
    const b = Buffer.alloc(2);
    b.writeUInt16BE(h.length);
    return Buffer.concat([b, h, Buffer.from(data)]);
  };
  assert.deepEqual([...audioFromFrame(frame("X-RequestId:1\r\nPath:audio\r\n", [1, 2, 3]))!], [1, 2, 3]);
  assert.equal(audioFromFrame(frame("Path:audio.metadata\r\n", [1])), null, "not metadata");
  assert.deepEqual([...audioFromFrame(frame("Path:audio", [9]))!], [9]);
  assert.equal(audioFromFrame(frame("Path:turn.start\r\n", [1])), null);
  assert.equal(audioFromFrame(Buffer.from([0])), null);
});

test("only the admin manages providers", async () => {
  await me("PUT", "/api/admin/registration", { open: true });
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "anna", password: "anna-password" } });
  const anna = await login("anna", "anna-password");
  assert.equal((await anna("GET", "/api/admin/tts")).statusCode, 403);
  assert.equal((await anna("PUT", "/api/admin/tts", { edge: true })).statusCode, 403);
  assert.equal((await anna("POST", "/api/admin/tts/test", { voice: "azure:de-DE-KatjaNeural" })).statusCode, 403);
  // …but can use the voices the admin set up.
  assert.equal((await anna("GET", `/api/tts?${new URLSearchParams({ voice: "azure:de-DE-KatjaNeural", text: "Hallo Anna" })}`)).statusCode, 200);
});

// One MPEG-2 Layer III frame, 24 kHz, 48 kbit/s mono (Azure's format): 144 bytes, 24 ms.
const frame = () => {
  const f = new Uint8Array(144);
  f.set([0xff, 0xf3, 0x64, 0xc0]);
  return f;
};

test("story audio: made on demand in the reading voice, timed by paragraph, served with ranges", async () => {
  const { EXAMPLE_STORY } = await import("@mdb/shared");
  // A clip lasts one frame per word of its text.
  azureAudio = (body) => {
    const words = body.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length;
    const out = new Uint8Array(words * 144);
    for (let i = 0; i < words; i++) out.set(frame(), i * 144);
    return out;
  };
  const story = { ...EXAMPLE_STORY, id: "hoerbuch", body: "# Kapitel eins\n\nAnna geht nach Hause.\n\n---\n\nSie kocht eine Suppe." };
  assert.equal((await me("POST", "/api/stories", { story })).statusCode, 200);

  // The device voice reads: no file can be made.
  const settings = (await me("GET", "/api/settings")).json();
  await me("PUT", "/api/settings", { ...settings, ttsVoice: "", readerVoice: "device" });
  assert.equal((await me("GET", "/api/stories/hoerbuch/audio")).json().state, "none");
  assert.equal((await me("POST", "/api/stories/hoerbuch/audio")).statusCode, 409);

  await me("PUT", "/api/settings", { ...settings, ttsVoice: "", readerVoice: "azure:de-DE-Seraphina:DragonHDLatestNeural" });
  const started = (await me("POST", "/api/stories/hoerbuch/audio")).json();
  assert.ok(["building", "ready"].includes(started.state));
  let status = started;
  for (let i = 0; i < 50 && status.state !== "ready"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    status = (await me("GET", "/api/stories/hoerbuch/audio")).json();
  }
  assert.equal(status.state, "ready", JSON.stringify(status));
  assert.equal(status.voice, "azure:de-DE-Seraphina:DragonHDLatestNeural");
  // "Kapitel eins" (2 words), "Anna geht nach Hause." (4), the rule (nothing), "Sie kocht eine Suppe." (4).
  assert.deepEqual(status.starts, [0, 0.048, 0.144, 0.144]);
  assert.equal(status.duration, 0.24);
  assert.equal(status.bytes, 10 * 144);

  const url = `/api/stories/hoerbuch/audio/${status.key}.mp3`;
  const whole = await me("GET", url);
  assert.equal(whole.statusCode, 200);
  assert.equal(whole.rawPayload.length, 1440);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "yamen", password: "admin-password" } });
  const cookie = `mdb_session=${login.cookies.find((c) => c.name === "mdb_session")!.value}`;
  const part = await app.inject({ method: "GET", url, headers: { cookie, range: "bytes=144-287" } });
  assert.equal(part.statusCode, 206);
  assert.equal(part.headers["content-range"], "bytes 144-287/1440");
  assert.equal(part.rawPayload.length, 144);
  assert.equal((await me("GET", "/api/stories/hoerbuch/audio/" + "0".repeat(32))).statusCode, 404, "an old or unknown key");

  // Another voice makes another file; the story's own words ("Kapitel eins") went to the HD voice.
  assert.ok(calls.some((c) => c.body.includes("de-DE-Seraphina:DragonHDLatestNeural") && c.body.includes("Kapitel eins")));
  await me("PUT", "/api/settings", settings);
  azureAudio = () => new Uint8Array([0xff, 0xf3, 1, 2, 3]);
});

test("story audio: a voice's limit makes it wait, not fail; it carries on where it stopped", async () => {
  const { EXAMPLE_STORY } = await import("@mdb/shared");
  const body = ["Erster Satz hier.", "Zweiter Satz hier.", "Dritter Satz hier.", "Vierter Satz hier."].join("\n\n");
  assert.equal((await me("POST", "/api/stories", { story: { ...EXAMPLE_STORY, id: "warten", body } })).statusCode, 200);
  const settings = (await me("GET", "/api/settings")).json();
  await me("PUT", "/api/settings", { ...settings, ttsVoice: "", readerVoice: "azure:de-DE-ConradNeural" });
  const status = async () => (await me("GET", "/api/stories/warten/audio")).json();
  const until = async (state: string) => {
    let s = await status();
    for (let i = 0; i < 100 && s.state !== state; i++) {
      await new Promise((r) => setTimeout(r, 20));
      s = await status();
    }
    return s;
  };

  // The limit is reached after two clips.
  let made = 0;
  azureAudio = () => {
    if (made >= 2) throw Object.assign(new Error("429"), { status: 429 });
    made++;
    return frame();
  };
  await me("POST", "/api/stories/warten/audio");
  const waiting = await until("waiting");
  assert.equal(waiting.state, "waiting", JSON.stringify(waiting));
  assert.equal(waiting.done, 2);
  assert.equal(waiting.total, 4);
  assert.ok(waiting.retryAt > Date.now() / 1000 + 25 * 60, "a limit that doesn't say when: about half an hour");

  // The limit lifts; asked again, it goes on, making only the clips it lacked.
  azureAudio = () => {
    made++;
    return frame();
  };
  await me("POST", "/api/stories/warten/audio");
  const ready = await until("ready");
  assert.equal(ready.state, "ready", JSON.stringify(ready));
  assert.equal(made, 4, "the first two clips came from the cache");
  assert.equal(ready.duration, 0.096);

  await me("PUT", "/api/settings", settings);
  azureAudio = () => new Uint8Array([0xff, 0xf3, 1, 2, 3]);
});

test("story audio for lists, and generating a whole book's in chapter order", async () => {
  const { EXAMPLE_SERIES, EXAMPLE_STORY } = await import("@mdb/shared");
  const settings = (await me("GET", "/api/settings")).json();
  await me("PUT", "/api/settings", { ...settings, ttsVoice: "", readerVoice: "azure:de-DE-ConradNeural" });
  azureAudio = () => frame();
  const all = (await me("GET", "/api/story-audio")).json();
  assert.equal(all.warten.state, "ready", "made in the last test");
  assert.ok(all.warten.duration > 0);

  assert.equal((await me("POST", "/api/series", { series: EXAMPLE_SERIES })).statusCode, 200);
  for (const [n, title] of [[2, "Zwei"], [1, "Eins"]] as const) {
    const res = await me("PUT", `/api/series/${EXAMPLE_SERIES.id}/chapters/${n}`, { story: { ...EXAMPLE_STORY, id: "x", title, body: `Kapitel ${title} beginnt hier.` }, summary: `Kapitel ${n}.` });
    assert.equal(res.statusCode, 200, res.body);
  }
  // Made in the background (nobody waits for it), which would pause after the live clips above.
  const { setLivePauseForTests } = await import("../services/storyAudio");
  setLivePauseForTests(0);
  calls.length = 0;
  const queued = await me("POST", `/api/series/${EXAMPLE_SERIES.id}/audio`);
  assert.equal(queued.statusCode, 200, queued.body);
  const ids = Object.keys(queued.json());
  assert.equal(ids.length, 2);
  for (let i = 0; i < 100 && Object.values((await me("GET", "/api/story-audio")).json()).some((a) => (a as { state: string }).state !== "ready" && (a as { state: string }).state !== "none"); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const after = (await me("GET", "/api/story-audio")).json();
  for (const id of ids) assert.equal(after[id].state, "ready", id);
  // Chapter 1 was made first (the order of the book, not of writing).
  const first = calls.findIndex((c) => c.body.includes("Kapitel Eins"));
  const second = calls.findIndex((c) => c.body.includes("Kapitel Zwei"));
  assert.ok(first >= 0 && first < second, `${first} < ${second}`);
  assert.equal((await me("POST", "/api/series/nope/audio")).statusCode, 404);
  await me("PUT", "/api/settings", settings);
  azureAudio = () => new Uint8Array([0xff, 0xf3, 1, 2, 3]);
});

test("an Azure 400 for a voice the region doesn't offer says so", async () => {
  // A fresh region without HD voices, so the voice list is fetched for it.
  regionVoiceNames = ["de-DE-KatjaNeural"];
  assert.equal((await me("PUT", "/api/admin/tts", { azure: { region: "northeurope" } })).statusCode, 200);
  azureAudio = (body) => {
    if (body.includes("DragonHD")) throw Object.assign(new Error("400"), { status: 400 });
    return new Uint8Array([0xff, 0xf3, 1, 2, 3]);
  };
  const res = await tts("azure:de-DE-Florian:DragonHDLatestNeural", "Guten Morgen");
  assert.equal(res.statusCode, 503, res.body);
  assert.match(res.json().error, /isn't offered in your Azure region \(northeurope\)/);
  const voicesCall = calls.find((c) => c.url.endsWith("/cognitiveservices/voices/list"));
  assert.ok(voicesCall, "it asked Azure which voices the region has");
  assert.match(calls.filter((c) => c.url.endsWith("/v1")).at(-1)!.body, /^<speak version='1.0' xmlns='http:\/\/www.w3.org\/2001\/10\/synthesis' xml:lang='de-DE'>/);
  // …and the voice list leaves out HD voices the region doesn't have.
  const ids = ((await me("GET", "/api/tts/status")).json().voices as { id: string }[]).map((v) => v.id);
  assert.ok(ids.includes("azure:de-DE-KatjaNeural"));
  assert.ok(!ids.some((id) => id.includes("DragonHD")), "no HD voices offered in this region");
  azureAudio = () => new Uint8Array([0xff, 0xf3, 1, 2, 3]);
});

test("Gemini: a stored key adds its voices; PCM comes back as MP3 of the same length; its limit is said plainly", async () => {
  assert.equal((await me("POST", "/api/admin/tts/gemini/keys", { label: "Free", kind: "free" })).statusCode, 400, "a key is needed");
  const set = await me("POST", "/api/admin/tts/gemini/keys", { label: "Free", kind: "free", key: "secret-gemini-key-123" });
  assert.equal(set.statusCode, 200, set.body);
  assert.deepEqual(set.json().gemini.keys, [{ id: set.json().gemini.keys[0].id, provider: "gemini", region: null, label: "Free", kind: "free", hint: "-123", unreadable: false }]);
  assert.deepEqual(
    set.json().gemini.entries.map((x: { model: string; background: boolean }) => [x.model, x.background]),
    [["gemini-3.8-flash-tts", true], ["gemini-3.8-flash-lite-tts", true]],
    "a key joins the order with both models",
  );
  assert.ok(!set.body.includes("secret-gemini"), "the key is never sent back");
  const status = (await me("GET", "/api/tts/status")).json();
  assert.ok(status.voices.some((v: { id: string; provider: string }) => v.id === "gemini:Kore" && v.provider === "gemini"));

  calls.length = 0;
  const clip = await tts("gemini:Kore", "Guten Morgen!");
  assert.equal(clip.statusCode, 200, clip.body);
  assert.equal(clip.headers["content-type"], "audio/mpeg");
  const call = calls.find((c) => c.url.includes("generativelanguage"))!;
  assert.equal(call.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent");
  assert.equal(call.headers["x-goog-api-key"], "secret-gemini-key-123");
  const body = JSON.parse(call.body);
  assert.equal(body.contents[0].parts[0].text, "Guten Morgen!");
  assert.equal(body.generationConfig.speechConfig.voiceConfig.voice, "Kore");
  assert.deepEqual(body.generationConfig.responseFormat.audio, { mimeType: "AUDIO_L16", sampleRate: 24000 });
  const { mp3Frames } = await import("../tts/mp3");
  const seconds = mp3Frames(clip.rawPayload).seconds;
  assert.ok(seconds > 0.95 && seconds < 1.15, `about a second of audio, got ${seconds}`);

  geminiReply = () => new Response(JSON.stringify({ error: { code: 429, details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3600s" }] } }), { status: 429 });
  const limited = await tts("gemini:Aoede", "Noch ein Satz.");
  assert.equal(limited.statusCode, 503);
  assert.match(limited.json().error, /Gemini's limit is used up/);

  const { retryDelay } = await import("../tts/gemini");
  assert.equal(retryDelay({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "12.4s" }] } }), 13);
  assert.equal(retryDelay(null), null);
  const removed = await me("DELETE", `/api/admin/tts/gemini/keys/${set.json().gemini.keys[0].id}`);
  assert.deepEqual(removed.json().gemini, { keys: [], entries: [] });
  geminiReply = defaultGemini;
});

test("Gemini story audio: paragraphs asked for together and cut in the pauses; its daily limit is said; the first paragraphs can be heard meanwhile", async () => {
  const { EXAMPLE_STORY } = await import("@mdb/shared");
  const added = await me("POST", "/api/admin/tts/gemini/keys", { label: "Free", kind: "free", key: "secret-gemini-key-123" });
  assert.equal(added.statusCode, 200, added.body);
  const settings = (await me("GET", "/api/settings")).json();
  await me("PUT", "/api/settings", { ...settings, ttsVoice: "", readerVoice: "gemini:Kore" });
  const { setLivePauseForTests } = await import("../services/storyAudio");
  setLivePauseForTests(0);

  // "Gemini" reads each paragraph (blank lines between) as a tone as long as its text, with a pause after it.
  const RATE = 24_000;
  let requests = 0;
  let limitAfter = Infinity;
  geminiReply = () => {
    const text = JSON.parse(calls.at(-1)!.body).contents[0].parts[0].text as string;
    if (requests++ >= limitAfter) {
      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                violations: [
                  {
                    description: "Generate content requests per day limit exceeded on Tier 1.",
                    quotaMetric: "generativelanguage.googleapis.com/generate_requests_per_model_per_day",
                    quotaId: "GenerateRequestsPerDayPerProjectPerModel",
                    quotaValue: "100",
                  },
                ],
              },
              { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "22695s" },
            ],
          },
        }),
        { status: 429 },
      );
    }
    const samples: number[] = [];
    for (const p of text.split("\n\n")) {
      for (let i = 0; i < p.length * 0.05 * RATE; i++) samples.push(Math.round(8000 * Math.sin(i / 7)));
      for (let i = 0; i < 0.5 * RATE; i++) samples.push(0);
    }
    const pcm = Buffer.alloc(samples.length * 2);
    samples.forEach((v, i) => pcm.writeInt16LE(v, i * 2));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString("base64") } }] } }] }), { status: 200 });
  };
  const until = async (id: string, state: string) => {
    let s = (await me("GET", `/api/stories/${id}/audio`)).json();
    for (let i = 0; i < 200 && s.state !== state; i++) {
      await new Promise((r) => setTimeout(r, 20));
      s = (await me("GET", `/api/stories/${id}/audio`)).json();
    }
    return s;
  };

  // Five short paragraphs: one request; each paragraph starts where its tone does.
  const paras = ["Eins zwei drei.", "Hier ist der zweite Absatz, er ist länger.", "Kurz.", "Der vierte Absatz ist wieder etwas länger als die anderen.", "Ende."];
  assert.equal((await me("POST", "/api/stories", { story: { ...EXAMPLE_STORY, id: "gruppe", body: paras.join("\n\n") } })).statusCode, 200);
  await me("POST", "/api/stories/gruppe/audio");
  const ready = await until("gruppe", "ready");
  assert.equal(ready.state, "ready", JSON.stringify(ready));
  assert.equal(requests, 1, "one request for the whole story");
  let t = 0;
  paras.forEach((p, i) => {
    assert.ok(Math.abs(ready.starts[i] - t) < 0.4, `paragraph ${i} starts near ${t.toFixed(2)}, got ${ready.starts[i]}`);
    t += p.length * 0.05 + 0.5;
  });
  // Each paragraph's clip is cached on its own: "Read aloud" of one needs no request.
  assert.equal((await tts("gemini:Kore", paras[3]!)).statusCode, 200);
  assert.equal(requests, 1);

  // Eight long paragraphs make two requests; the second meets the daily limit.
  const long = Array.from({ length: 8 }, (_, i) => `Absatz ${i + 1}. ${"Das ist ein langer Satz über einen Tag in der Stadt. ".repeat(7)}`);
  assert.equal((await me("POST", "/api/stories", { story: { ...EXAMPLE_STORY, id: "limit", body: long.join("\n\n") } })).statusCode, 200);
  requests = 0;
  limitAfter = 1;
  assert.equal((await me("POST", "/api/stories/limit/audio/partial")).statusCode, 404, "nothing made yet");
  await me("POST", "/api/stories/limit/audio");
  const waiting = await until("limit", "waiting");
  assert.equal(waiting.state, "waiting", JSON.stringify(waiting));
  // Both models of the key met it (Google's limits are per model); someone was waiting, so: listening.
  assert.match(waiting.waitReason, /^Every Gemini key for listening is at its limit; the first back: Gemini's daily limit is used up \(100 requests a day for gemini-3.8-flash-tts, Tier 1\)/);
  const { nextReset } = await import("../tts/geminiKeys");
  assert.ok(Math.abs(waiting.retryAt - nextReset()) < 5, "a daily limit: back when Google's day starts");
  assert.ok(waiting.readyParagraphs > 0 && waiting.readyParagraphs < 8, JSON.stringify(waiting));
  assert.equal(waiting.paragraphs, 8);
  const brief = (await me("GET", "/api/story-audio")).json().limit;
  assert.equal(brief.waitReason, waiting.waitReason);

  const partial = await me("POST", "/api/stories/limit/audio/partial");
  assert.equal(partial.statusCode, 200, partial.body);
  assert.equal(partial.json().paragraphs, waiting.readyParagraphs);
  assert.equal(partial.json().of, 8);
  assert.equal(partial.json().starts.length, waiting.readyParagraphs);
  const file = await me("GET", `/api/stories/limit/audio/${partial.json().key}.mp3`);
  assert.equal(file.statusCode, 200);
  assert.ok(file.rawPayload.length > 0);

  // The limit lifts (a new day): asked again, it finishes (the rest only), and the whole file replaces the partial one.
  limitAfter = Infinity;
  await newGoogleDay();
  await me("POST", "/api/stories/limit/audio");
  const done = await until("limit", "ready");
  assert.equal(done.state, "ready", JSON.stringify(done));
  assert.equal((await me("POST", "/api/stories/limit/audio/partial")).statusCode, 404, "it's ready: the whole file");

  const { limitReason } = await import("../tts/gemini");
  assert.equal(limitReason(null, "m"), "Gemini's limit is used up for now");
  assert.equal(
    limitReason({ error: { details: [{ "@type": "x.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quotaValue: "10" }] }] } }, "m"),
    "Gemini's per-minute limit is used up (10 requests a minute for m, free tier)",
  );

  geminiReply = defaultGemini;
  await me("PUT", "/api/settings", settings);
  await me("DELETE", `/api/admin/tts/gemini/keys/${added.json().gemini.keys[0].id}`);
});

test("Gemini keys in order: a limit passes to the next; paid only where allowed; counted per day; Edge reads taps when all are used up", async () => {
  const free = (await me("POST", "/api/admin/tts/gemini/keys", { label: "Free", kind: "free", key: "free-key-0000000001" })).json();
  const both = (await me("POST", "/api/admin/tts/gemini/keys", { label: "Paid", kind: "paid", key: "paid-key-0000000002" })).json();
  const [freeId, paidId] = both.gemini.keys.map((x: { id: number }) => x.id);
  assert.ok(free.gemini.keys.length === 1 && both.gemini.keys.length === 2);
  // A paid key isn't for the background unless switched on.
  assert.deepEqual(
    both.gemini.entries.map((x: { keyId: number; model: string; background: boolean; waiting: boolean; taps: boolean }) => [x.keyId, x.model.includes("lite"), x.background, x.waiting, x.taps]),
    [
      [freeId, false, true, true, true],
      [freeId, true, true, true, true],
      [paidId, false, false, true, true],
      [paidId, true, false, true, true],
    ],
  );
  // The order is what's saved: free Flash for everything, then paid Flash when waiting and for taps.
  const saved = await me("PUT", "/api/admin/tts/gemini/entries", {
    entries: [
      { keyId: freeId, model: "gemini-3.8-flash-tts", background: true, waiting: true, taps: true },
      { keyId: paidId, model: "gemini-3.8-flash-tts", background: false, waiting: true, taps: true },
    ],
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().gemini.entries.length, 2);
  assert.equal((await me("PUT", "/api/admin/tts/gemini/entries", { entries: [{ keyId: 999, model: "gemini-3.8-flash-tts", background: true, waiting: true, taps: true }] })).statusCode, 400);

  // The free key is at its daily limit; the paid one answers.
  const daily = () =>
    new Response(
      JSON.stringify({
        error: {
          code: 429,
          details: [
            { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generate_requests_per_model_per_day", quotaValue: "100", description: "on Free tier" }] },
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "20000s" },
          ],
        },
      }),
      { status: 429 },
    );
  geminiReply = () => (calls.at(-1)!.headers["x-goog-api-key"] === "free-key-0000000001" ? daily() : defaultGemini());
  calls.length = 0;
  const tapped = await tts("gemini:Kore", "Ein Satz zum Tippen.");
  assert.equal(tapped.statusCode, 200, tapped.body);
  assert.deepEqual(
    calls.map((c) => c.headers["x-goog-api-key"]),
    ["free-key-0000000001", "paid-key-0000000002"],
  );
  const view = (await me("GET", "/api/admin/tts")).json();
  const [f, p] = view.gemini.entries;
  assert.ok(f.limitedUntil > Date.now() / 1000 && /daily limit/.test(f.limitReason), JSON.stringify(f));
  assert.equal(p.usedToday, 1);
  assert.ok(p.secondsToday > 0.9, "about a second of audio");

  // The background may not use the paid key: with the free one at its limit, it waits.
  const { withGemini } = await import("../tts/geminiKeys");
  await assert.rejects(
    withGemini("background", 1, async () => ({ result: 1, seconds: 0 })),
    (err: Error) => err.constructor.name === "TtsRateLimited" && /daily limit/.test(err.message),
  );

  // Everything used up: taps are read by Edge (not kept as Kore's); story audio isn't.
  geminiReply = daily;
  const { setEdgeForTests } = await import("../tts/edge");
  setEdgeForTests(async () => Buffer.from(frame()));
  assert.equal((await tts("gemini:Kore", "Noch ein anderer Satz.")).statusCode, 503, "no fallback until it's on");
  assert.equal((await me("PUT", "/api/admin/tts", { edgeFallback: true })).json().edgeFallback, true);
  const fallback = await tts("gemini:Kore", "Noch ein anderer Satz.");
  assert.equal(fallback.statusCode, 200, fallback.body);
  const { isCached } = await import("../tts/cache");
  assert.equal(isCached("Noch ein anderer Satz.", "gemini:Kore"), false, "Edge's reading isn't kept as Kore's");

  setEdgeForTests(null);
  geminiReply = defaultGemini;
  await me("PUT", "/api/admin/tts", { edgeFallback: false });
  await newGoogleDay();
  await me("DELETE", `/api/admin/tts/gemini/keys/${freeId}`);
  await me("DELETE", `/api/admin/tts/gemini/keys/${paidId}`);
});

test("audiobooks made ahead of time: each learner's own setting, off by default; on, unread stories by itself, within the learner's share of the day", async () => {
  const { EXAMPLE_STORY } = await import("@mdb/shared");
  const key = (await me("POST", "/api/admin/tts/gemini/keys", { label: "Free", kind: "free", key: "free-key-0000000003" })).json().gemini.keys[0].id;
  const settings = (await me("GET", "/api/settings")).json();
  await me("PUT", "/api/settings", { ...settings, ttsVoice: "", readerVoice: "gemini:Charon" });
  const { resetBackgroundForTests, resumeStoryAudio, setLivePauseForTests } = await import("../services/storyAudio");
  setLivePauseForTests(0);
  assert.equal((await me("POST", "/api/stories", { story: { ...EXAMPLE_STORY, id: "von-selbst", body: "Diese Geschichte wartet auf ihre Stimme." } })).statusCode, 200);
  const status = async () => (await me("GET", "/api/story-audio")).json()["von-selbst"].state;

  resetBackgroundForTests();
  resumeStoryAudio(app.log);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await status(), "none", "off: nothing is made by itself");

  const on = await me("PUT", "/api/settings", { ...settings, ttsVoice: "", readerVoice: "gemini:Charon", audiobooks: { auto: true, reserve: 0.2 } });
  assert.deepEqual(on.json().audiobooks, { auto: true, reserve: 0.2 });
  resetBackgroundForTests();
  resumeStoryAudio(app.log);
  let state = await status();
  for (let i = 0; i < 200 && state !== "ready"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    state = await status();
  }
  assert.equal(state, "ready", "made by itself");

  // Read stories come last (to listen to again), after the unread ones.
  const { backgroundCandidates } = await import("../services/storyAudio");
  assert.equal((await me("POST", "/api/stories", { story: { ...EXAMPLE_STORY, id: "schon-gelesen", body: "Diese kenne ich schon." } })).statusCode, 200);
  assert.equal((await me("POST", "/api/stories", { story: { ...EXAMPLE_STORY, id: "noch-neu", body: "Diese ist noch neu." } })).statusCode, 200);
  assert.equal((await me("POST", "/api/stories/schon-gelesen/read")).statusCode, 200);
  const order = backgroundCandidates(1);
  assert.ok(order.includes("schon-gelesen"), "read stories are made too");
  assert.ok(order.indexOf("noch-neu") < order.indexOf("schon-gelesen"), order.join(", "));

  // Its share used up (80 of 100 for the background, 20 kept for people): no room left.
  const { db, schema } = await import("../db/client");
  const { googleDay, backgroundRoom } = await import("../tts/geminiKeys");
  db.delete(schema.ttsUsage).run();
  for (const entry of db.select().from(schema.ttsEntries).all()) {
    db.insert(schema.ttsUsage).values({ entryId: entry.id, day: googleDay(), requests: 80, seconds: 0 }).run();
  }
  assert.equal(backgroundRoom(1), 0);

  await newGoogleDay();
  await me("PUT", "/api/settings", settings);
  await me("DELETE", `/api/admin/tts/gemini/keys/${key}`);
});

test("a learner's own voice keys: theirs first, never anyone else's; the server's after them as the admin shares them", async () => {
  const anna = await login("anna", "anna-password");
  const server = (await me("POST", "/api/admin/tts/gemini/keys", { label: "Server paid", kind: "paid", key: "server-key-000000009" })).json();
  const serverKey = server.gemini.keys[0].id;

  // Nothing of her own yet: the server's entries come after (all of them, as shared with everyone).
  let mine = (await anna("GET", "/api/tts/mine")).json();
  assert.deepEqual(mine.keys, []);
  assert.equal(mine.server.entries.length, 2);
  assert.ok((await anna("GET", "/api/tts/status")).json().voices.some((v: { id: string }) => v.id === "gemini:Kore"));

  // Her own key: tried first for her taps.
  const added = await anna("POST", "/api/tts/mine/keys", { label: "Mine", kind: "free", key: "anna-key-0000000001" });
  assert.equal(added.statusCode, 200, added.body);
  mine = added.json();
  assert.equal(mine.keys.length, 1);
  assert.equal(mine.entries.length, 2);
  calls.length = 0;
  assert.equal((await anna("GET", `/api/tts?${new URLSearchParams({ voice: "gemini:Kore", text: "Annas eigener Satz." })}`)).statusCode, 200);
  assert.equal(calls.at(-1)!.headers["x-goog-api-key"], "anna-key-0000000001");

  // Hers only: the admin's list doesn't show it, he can't change or remove it, his taps never use it.
  assert.ok(!(await me("GET", "/api/admin/tts")).json().gemini.keys.some((x: { label: string }) => x.label === "Mine"));
  assert.equal((await me("GET", "/api/tts/mine")).json().keys.length, 0);
  assert.equal((await me("DELETE", `/api/tts/mine/keys/${mine.keys[0].id}`)).statusCode, 404);
  assert.equal((await me("PUT", `/api/tts/mine/keys/${mine.keys[0].id}`, { label: "x", kind: "free" })).statusCode, 404);
  assert.equal((await me("PUT", "/api/tts/mine/entries", { entries: [{ keyId: mine.keys[0].id, model: "gemini-3.8-flash-tts", background: true, waiting: true, taps: true }] })).statusCode, 400);
  assert.equal((await anna("DELETE", `/api/admin/tts/gemini/keys/${serverKey}`)).statusCode, 403);
  calls.length = 0;
  assert.equal((await tts("gemini:Kore", "Der Satz des Admins.")).statusCode, 200);
  assert.equal(calls.at(-1)!.headers["x-goog-api-key"], "server-key-000000009");

  // An Azure key of her own: her Azure voices use it (and its region).
  const azure = await anna("POST", "/api/tts/mine/keys", { provider: "azure", region: "swedencentral", label: "My Azure", kind: "free", key: "anna-azure-key-000001" });
  assert.equal(azure.statusCode, 200, azure.body);
  assert.deepEqual(
    azure.json().keys.map((x: { provider: string; region: string | null }) => [x.provider, x.region]),
    [["gemini", null], ["azure", "swedencentral"]],
  );
  calls.length = 0;
  assert.equal((await anna("GET", `/api/tts?${new URLSearchParams({ voice: "azure:de-DE-KatjaNeural", text: "Anna mit Azure." })}`)).statusCode, 200);
  assert.ok(calls.at(-1)!.url.startsWith("https://swedencentral.tts.speech.microsoft.com/"));
  assert.equal(calls.at(-1)!.headers["Ocp-Apim-Subscription-Key"], "anna-azure-key-000001");

  // Shared with admins only: without her own Gemini key, she has no Gemini voices; with "free only", only the free server keys.
  await anna("DELETE", `/api/tts/mine/keys/${mine.keys[0].id}`);
  assert.equal((await me("PUT", "/api/admin/tts", { share: "admins" })).json().share, "admins");
  assert.equal((await anna("GET", "/api/tts/mine")).json().server.entries.length, 0);
  assert.ok(!(await anna("GET", "/api/tts/status")).json().voices.some((v: { id: string }) => v.id === "gemini:Kore"));
  assert.equal((await anna("GET", `/api/tts?${new URLSearchParams({ voice: "gemini:Kore", text: "Darf ich nicht." })}`)).statusCode, 503);
  assert.ok((await me("GET", "/api/tts/status")).json().voices.some((v: { id: string }) => v.id === "gemini:Kore"), "the admin still may");
  await me("PUT", "/api/admin/tts", { share: "free" });
  assert.equal((await anna("GET", "/api/tts/mine")).json().server.entries.length, 0, "the server's only key is paid");

  // The admin moves the server's keys to his own account.
  await me("PUT", "/api/admin/tts", { share: "all" });
  const moved = await me("POST", "/api/admin/tts/move-to-me");
  assert.deepEqual(moved.json().gemini, { keys: [], entries: [] });
  const his = (await me("GET", "/api/tts/mine")).json();
  assert.equal(his.keys.length, 1);
  assert.equal(his.entries.length, 2);
  assert.equal((await anna("GET", "/api/tts/mine")).json().server.entries.length, 0, "no longer the server's");

  await me("DELETE", `/api/tts/mine/keys/${his.keys[0].id}`);
  await anna("DELETE", `/api/tts/mine/keys/${azure.json().keys[1].id}`);
});
