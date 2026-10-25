import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { GEMINI_TTS_MODELS, type TtsEntryView, type TtsKeyView, type TtsPurpose } from "@mdb/shared";
import { decryptSecret, encryptSecret, isEncryptionAvailable } from "../assistant/secrets";
import { db, schema } from "../db/client";
import { TtsRateLimited, TtsUnavailable } from "./errors";
import { GeminiLimitError } from "./gemini";
import { backgroundSettings } from "./settings";

/**
 * Gemini keys and the order they're tried in. Google's limits are per
 * project and per model (100 requests a day for the TTS models, on the
 * free tier and Tier 1 alike), so each entry of the order is a key + a
 * model with its own count. A request goes down the order: an entry not
 * meant for this purpose, at a limit, or (in the background) at its share
 * is passed over, and one that meets a limit is marked until Google says.
 * Counts are this server's own (Google doesn't say what's left), by
 * Google's day, which starts at midnight Pacific. These are the server's
 * (user_id null); a learner's own keys can come later.
 */

type Model = (typeof GEMINI_TTS_MODELS)[number];
export class TtsKeyError extends Error {}

const pacific = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function pacificParts(now: number) {
  const p = Object.fromEntries(pacific.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, seconds: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second) };
}
/** Google's day ("2026-10-25"), which starts at midnight Pacific. */
export const googleDay = (now = Date.now()) => pacificParts(now).day;
/** When Google's day next starts (unix seconds). */
export const nextReset = (now = Date.now()) => Math.floor(now / 1000) + 86_400 - pacificParts(now).seconds;

const nowS = () => Math.floor(Date.now() / 1000);
const k = schema.ttsKeys;
const e = schema.ttsEntries;
const u = schema.ttsUsage;

const hint = (enc: string) => {
  const plain = decryptSecret(enc);
  return plain ? plain.slice(-4) : "";
};

export function listKeys(): TtsKeyView[] {
  return db
    .select()
    .from(k)
    .where(isNull(k.userId))
    .orderBy(asc(k.id))
    .all()
    .map((r) => ({ id: r.id, label: r.label, kind: r.kind, hint: hint(r.keyEnc), unreadable: decryptSecret(r.keyEnc) === null }));
}

export function listEntries(now = Date.now()): TtsEntryView[] {
  const day = googleDay(now);
  return db
    .select({ entry: e, requests: u.requests, seconds: u.seconds })
    .from(e)
    .leftJoin(u, and(eq(u.entryId, e.id), eq(u.day, day)))
    .where(isNull(e.userId))
    .orderBy(asc(e.position))
    .all()
    .map(({ entry: r, requests, seconds }) => ({
      id: r.id,
      keyId: r.keyId,
      model: (GEMINI_TTS_MODELS as readonly string[]).includes(r.model) ? (r.model as Model) : GEMINI_TTS_MODELS[0],
      background: r.useBackground,
      waiting: r.useWaiting,
      taps: r.useTaps,
      usedToday: requests ?? 0,
      dailyLimit: r.dailyLimit,
      secondsToday: Math.round((seconds ?? 0) * 10) / 10,
      limitedUntil: r.limitedUntil !== null && r.limitedUntil > now / 1000 ? r.limitedUntil : null,
      limitReason: r.limitedUntil !== null && r.limitedUntil > now / 1000 ? r.limitReason : null,
    }));
}

/**
 * Add a key; it joins the end of the order with both models (a free key
 * for everything, a paid one only when someone is waiting and for taps).
 */
export function addKey(body: { label: string; kind: "free" | "paid"; key?: string }): void {
  if (!body.key) throw new TtsKeyError("enter the Gemini API key");
  if (!isEncryptionAvailable) throw new TtsKeyError("set ENCRYPTION_KEY on the server to store keys");
  const id = db.insert(k).values({ label: body.label, kind: body.kind, keyEnc: encryptSecret(body.key) }).returning({ id: k.id }).get().id;
  let position = (db.select({ n: sql<number>`coalesce(max(${e.position}), -1)` }).from(e).where(isNull(e.userId)).get()?.n ?? -1) + 1;
  for (const model of GEMINI_TTS_MODELS) {
    db.insert(e).values({ keyId: id, model, position: position++, useBackground: body.kind === "free" }).run();
  }
}

export function updateKey(id: number, body: { label: string; kind: "free" | "paid"; key?: string }): boolean {
  const row = db.select().from(k).where(and(eq(k.id, id), isNull(k.userId))).get();
  if (!row) return false;
  if (body.key && !isEncryptionAvailable) throw new TtsKeyError("set ENCRYPTION_KEY on the server to store keys");
  db.update(k)
    .set({ label: body.label, kind: body.kind, ...(body.key ? { keyEnc: encryptSecret(body.key) } : {}) })
    .where(eq(k.id, id))
    .run();
  // A new key is another project: its limits start afresh.
  if (body.key) db.update(e).set({ limitedUntil: null, limitReason: null }).where(eq(e.keyId, id)).run();
  return true;
}

export function deleteKey(id: number): boolean {
  const row = db.select().from(k).where(and(eq(k.id, id), isNull(k.userId))).get();
  if (!row) return false;
  for (const { id: entryId } of db.select({ id: e.id }).from(e).where(eq(e.keyId, id)).all()) {
    db.delete(u).where(eq(u.entryId, entryId)).run();
  }
  db.delete(e).where(eq(e.keyId, id)).run();
  db.delete(k).where(eq(k.id, id)).run();
  return true;
}

/** The whole order at once (as listed); an entry kept (same key and model) keeps its counts and limits. */
export function saveEntries(list: { keyId: number; model: Model; background: boolean; waiting: boolean; taps: boolean }[]): void {
  const keys = new Set(listKeys().map((x) => x.id));
  const seen = new Set<string>();
  for (const x of list) {
    if (!keys.has(x.keyId)) throw new TtsKeyError("unknown key");
    const id = `${x.keyId}:${x.model}`;
    if (seen.has(id)) throw new TtsKeyError("each key and model once");
    seen.add(id);
  }
  const existing = db.select().from(e).where(isNull(e.userId)).all();
  db.transaction((tx) => {
    list.forEach((x, position) => {
      const was = existing.find((r) => r.keyId === x.keyId && r.model === x.model);
      const set = { position, useBackground: x.background, useWaiting: x.waiting, useTaps: x.taps };
      if (was) tx.update(e).set(set).where(eq(e.id, was.id)).run();
      else tx.insert(e).values({ keyId: x.keyId, model: x.model, ...set }).run();
    });
    for (const r of existing) {
      if (!seen.has(`${r.keyId}:${r.model}`)) {
        tx.delete(u).where(eq(u.entryId, r.id)).run();
        tx.delete(e).where(eq(e.id, r.id)).run();
      }
    }
  });
}

/** Whether Gemini can be used at all (some entry with a readable key). */
export function geminiReady(): boolean {
  return chain().length > 0;
}

type Link = { id: number; label: string; model: string; key: string; dailyLimit: number; limitedUntil: number | null; limitReason: string | null; uses: Record<TtsPurpose, boolean> };
function chain(): Link[] {
  return db
    .select({ entry: e, label: k.label, keyEnc: k.keyEnc })
    .from(e)
    .innerJoin(k, eq(k.id, e.keyId))
    .where(isNull(e.userId))
    .orderBy(asc(e.position))
    .all()
    .flatMap(({ entry: r, label, keyEnc }) => {
      const key = decryptSecret(keyEnc);
      return key
        ? [{ id: r.id, label, model: r.model, key, dailyLimit: r.dailyLimit, limitedUntil: r.limitedUntil, limitReason: r.limitReason, uses: { background: r.useBackground, waiting: r.useWaiting, taps: r.useTaps } }]
        : [];
    });
}

function usedToday(entryId: number, day: string): number {
  return db.select({ n: u.requests }).from(u).where(and(eq(u.entryId, entryId), eq(u.day, day))).get()?.n ?? 0;
}
function count(entryId: number, day: string, seconds: number): void {
  db.insert(u)
    .values({ entryId, day, requests: 1, seconds })
    .onConflictDoUpdate({ target: [u.entryId, u.day], set: { requests: sql`${u.requests} + 1`, seconds: sql`${u.seconds} + ${seconds}` } })
    .run();
}

/** How many requests background audio may still make today with the entries meant for it (for the auto queue). */
export function backgroundRoom(now = Date.now()): number {
  const { reserve } = backgroundSettings();
  const day = googleDay(now);
  return chain()
    .filter((l) => l.uses.background && !(l.limitedUntil && l.limitedUntil > now / 1000))
    .reduce((n, l) => n + Math.max(0, Math.floor(l.dailyLimit * (1 - reserve)) - usedToday(l.id, day)), 0);
}

const WHAT: Record<TtsPurpose, string> = { background: "background audio", waiting: "listening", taps: "reading words aloud" };

/**
 * Make one request with the first entry that may: `run` gets the key and
 * model and returns the result and the seconds of audio it made. Throws
 * TtsRateLimited (when the first one comes back) when every entry meant for
 * this purpose is at a limit, TtsUnavailable when none is meant for it.
 */
export async function withGemini<T>(purpose: TtsPurpose, run: (cfg: { key: string; model: string }) => Promise<{ result: T; seconds: number }>): Promise<T> {
  const links = chain().filter((l) => l.uses[purpose]);
  if (!links.length) throw new TtsUnavailable(`No Gemini key is set to be used for ${WHAT[purpose]}`);
  const { reserve } = backgroundSettings();
  let first: { at: number; reason: string } | null = null;
  const later = (at: number, reason: string) => {
    if (!first || at < first.at) first = { at, reason };
  };
  for (const l of links) {
    const now = Date.now();
    const day = googleDay(now);
    if (l.limitedUntil && l.limitedUntil > now / 1000) {
      later(l.limitedUntil, l.limitReason ?? "Gemini's limit is used up for now");
      continue;
    }
    const used = usedToday(l.id, day);
    if (used >= l.dailyLimit) {
      later(nextReset(now), `Gemini's daily limit is used up (${l.dailyLimit} requests a day for ${l.model}, ${l.label})`);
      continue;
    }
    if (purpose === "background" && used >= Math.floor(l.dailyLimit * (1 - reserve))) {
      later(nextReset(now), `The rest of today's Gemini requests are kept for people (${Math.round(reserve * 100)}%)`);
      continue;
    }
    try {
      const { result, seconds } = await run({ key: l.key, model: l.model });
      count(l.id, day, seconds);
      return result;
    } catch (err) {
      if (!(err instanceof GeminiLimitError)) throw err;
      const until = err.daily ? nextReset() : nowS() + Math.max(err.retryAfter ?? 60, 30);
      db.update(e)
        .set({ limitedUntil: until, limitReason: `${err.message} · ${l.label}`, ...(err.daily && err.quota ? { dailyLimit: err.quota } : {}) })
        .where(eq(e.id, l.id))
        .run();
      later(until, err.message);
    }
  }
  const f = first as { at: number; reason: string } | null;
  const reason = links.length > 1 ? `Every Gemini key for ${WHAT[purpose]} is at its limit; the first back: ${f?.reason ?? "unknown"}` : (f?.reason ?? "Gemini's limit is used up for now");
  throw new TtsRateLimited(reason, f ? Math.max(f.at - nowS(), 1) : null);
}
