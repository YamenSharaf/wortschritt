import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { GEMINI_TTS_MODELS, type MyVoices, type TtsEntryView, type TtsKeyView, type TtsPurpose } from "@mdb/shared";
import { decryptSecret, encryptSecret, isEncryptionAvailable } from "../assistant/secrets";
import { db, schema } from "../db/client";
import { getSettings } from "../services/settings";
import { TtsRateLimited, TtsUnavailable } from "./errors";
import { GeminiLimitError } from "./gemini";
import { serverShare } from "./settings";

/**
 * Voice keys (Gemini and Azure) and the order Gemini keys are tried in.
 * Keys belong to a learner (their own, for their stories and taps only) or
 * to the server (owner null, set up by the admin; who may use them is the
 * admin's "share" setting). Google's limits are per project and per model
 * (for the TTS models: 10 requests a day on the free tier, 100 on Tier 1),
 * so each entry of an order is a key + a model with its own count. A
 * request goes down the learner's own order, then the server's: an entry
 * not meant for this purpose, at a limit, or (in the background) at its
 * share is passed over, and one that meets a limit is marked until Google
 * says. Counts are this server's own (Google doesn't say what's left), by
 * Google's day, which starts at midnight Pacific.
 */

type Model = (typeof GEMINI_TTS_MODELS)[number];
/** Whose keys: a learner's (their id) or the server's (null). */
export type Owner = number | null;
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
const ownedKeys = (owner: Owner) => (owner === null ? isNull(k.userId) : eq(k.userId, owner));
const ownedEntries = (owner: Owner) => (owner === null ? isNull(e.userId) : eq(e.userId, owner));

const hint = (enc: string) => {
  const plain = decryptSecret(enc);
  return plain ? plain.slice(-4) : "";
};

export function listKeys(owner: Owner): TtsKeyView[] {
  return db
    .select()
    .from(k)
    .where(ownedKeys(owner))
    .orderBy(asc(k.id))
    .all()
    .map((r) => ({ id: r.id, provider: r.provider, region: r.region, label: r.label, kind: r.kind, hint: hint(r.keyEnc), unreadable: decryptSecret(r.keyEnc) === null }));
}

export function listEntries(owner: Owner, now = Date.now()): TtsEntryView[] {
  const day = googleDay(now);
  return db
    .select({ entry: e, requests: u.requests, seconds: u.seconds })
    .from(e)
    .leftJoin(u, and(eq(u.entryId, e.id), eq(u.day, day)))
    .where(ownedEntries(owner))
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
 * What a key's entries start out allowing a day: Google's answers to the
 * TTS models say 10 requests on the free tier, 100 on Tier 1. Each entry
 * then learns the real number from the first limit it meets.
 */
const dailyLimitFor = (kind: "free" | "paid") => (kind === "free" ? 10 : 100);

type KeyBody = { provider?: "gemini" | "azure"; region?: string; label: string; kind: "free" | "paid"; key?: string };

/**
 * Add a key. A Gemini key joins the end of the order with both models (a
 * free key for everything, a paid one only when someone is waiting and for
 * taps); an Azure key needs its region, and replaces the owner's Azure key.
 */
export function addKey(owner: Owner, body: KeyBody): void {
  if (!body.key) throw new TtsKeyError(`enter the ${body.provider === "azure" ? "Azure Speech" : "Gemini API"} key`);
  if (!isEncryptionAvailable) throw new TtsKeyError("set ENCRYPTION_KEY on the server to store keys");
  if (body.provider === "azure") {
    if (!body.region) throw new TtsKeyError("enter the Azure region");
    db.delete(k).where(and(ownedKeys(owner), eq(k.provider, "azure"))).run();
    db.insert(k).values({ userId: owner, provider: "azure", region: body.region, label: body.label, kind: body.kind, keyEnc: encryptSecret(body.key) }).run();
    return;
  }
  const id = db.insert(k).values({ userId: owner, provider: "gemini", label: body.label, kind: body.kind, keyEnc: encryptSecret(body.key) }).returning({ id: k.id }).get().id;
  let position = (db.select({ n: sql<number>`coalesce(max(${e.position}), -1)` }).from(e).where(ownedEntries(owner)).get()?.n ?? -1) + 1;
  for (const model of GEMINI_TTS_MODELS) {
    db.insert(e).values({ userId: owner, keyId: id, model, position: position++, useBackground: body.kind === "free", dailyLimit: dailyLimitFor(body.kind) }).run();
  }
}

export function updateKey(owner: Owner, id: number, body: KeyBody): boolean {
  const row = db.select().from(k).where(and(eq(k.id, id), ownedKeys(owner))).get();
  if (!row) return false;
  if (body.key && !isEncryptionAvailable) throw new TtsKeyError("set ENCRYPTION_KEY on the server to store keys");
  db.update(k)
    .set({ label: body.label, kind: body.kind, ...(row.provider === "azure" && body.region ? { region: body.region } : {}), ...(body.key ? { keyEnc: encryptSecret(body.key) } : {}) })
    .where(eq(k.id, id))
    .run();
  // A new key is another project: its limits start afresh.
  if (body.key) db.update(e).set({ limitedUntil: null, limitReason: null }).where(eq(e.keyId, id)).run();
  return true;
}

export function deleteKey(owner: Owner, id: number): boolean {
  const row = db.select().from(k).where(and(eq(k.id, id), ownedKeys(owner))).get();
  if (!row) return false;
  for (const { id: entryId } of db.select({ id: e.id }).from(e).where(eq(e.keyId, id)).all()) {
    db.delete(u).where(eq(u.entryId, entryId)).run();
  }
  db.delete(e).where(eq(e.keyId, id)).run();
  db.delete(k).where(eq(k.id, id)).run();
  return true;
}

/** The whole order at once (as listed); an entry kept (same key and model) keeps its counts and limits. */
export function saveEntries(owner: Owner, list: { keyId: number; model: Model; background: boolean; waiting: boolean; taps: boolean }[]): void {
  const keyKind = new Map(listKeys(owner).filter((x) => x.provider === "gemini").map((x) => [x.id, x.kind]));
  const seen = new Set<string>();
  for (const x of list) {
    if (!keyKind.has(x.keyId)) throw new TtsKeyError("unknown key");
    const id = `${x.keyId}:${x.model}`;
    if (seen.has(id)) throw new TtsKeyError("each key and model once");
    seen.add(id);
  }
  const existing = db.select().from(e).where(ownedEntries(owner)).all();
  db.transaction((tx) => {
    list.forEach((x, position) => {
      const was = existing.find((r) => r.keyId === x.keyId && r.model === x.model);
      const set = { position, useBackground: x.background, useWaiting: x.waiting, useTaps: x.taps };
      if (was) tx.update(e).set(set).where(eq(e.id, was.id)).run();
      else tx.insert(e).values({ userId: owner, keyId: x.keyId, model: x.model, ...set, dailyLimit: dailyLimitFor(keyKind.get(x.keyId)!) }).run();
    });
    for (const r of existing) {
      if (!seen.has(`${r.keyId}:${r.model}`)) {
        tx.delete(u).where(eq(u.entryId, r.id)).run();
        tx.delete(e).where(eq(e.id, r.id)).run();
      }
    }
  });
}

/** The server's keys become this learner's own (their order after any of their own), counts and all. */
export function moveServerKeys(userId: number): void {
  const offset = (db.select({ n: sql<number>`coalesce(max(${e.position}), -1)` }).from(e).where(eq(e.userId, userId)).get()?.n ?? -1) + 1;
  db.transaction((tx) => {
    // One Azure key each: the server's replaces theirs only if they have none.
    const theirAzure = tx.select().from(k).where(and(eq(k.userId, userId), eq(k.provider, "azure"))).get();
    tx.update(k)
      .set({ userId })
      .where(and(isNull(k.userId), theirAzure ? eq(k.provider, "gemini") : sql`1 = 1`))
      .run();
    tx.update(e)
      .set({ userId, position: sql`${e.position} + ${offset}` })
      .where(isNull(e.userId))
      .run();
  });
}

/** May this learner use the server's keys, and which: all, the free ones, or none. */
function serverAccess(userId: number): "all" | "free" | "none" {
  const share = serverShare();
  if (share === "all") return "all";
  if (share === "free") return isAdmin(userId) ? "all" : "free";
  return isAdmin(userId) ? "all" : "none";
}
const isAdmin = (userId: number) => db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, userId)).get()?.role === "admin";

type Link = {
  id: number;
  label: string;
  model: string;
  kind: "free" | "paid";
  key: string;
  dailyLimit: number;
  limitedUntil: number | null;
  limitReason: string | null;
  uses: Record<TtsPurpose, boolean>;
};
function links(owner: Owner): Link[] {
  return db
    .select({ entry: e, label: k.label, kind: k.kind, keyEnc: k.keyEnc })
    .from(e)
    .innerJoin(k, eq(k.id, e.keyId))
    .where(and(ownedEntries(owner), eq(k.provider, "gemini")))
    .orderBy(asc(e.position))
    .all()
    .flatMap(({ entry: r, label, kind, keyEnc }) => {
      const key = decryptSecret(keyEnc);
      return key
        ? [{ id: r.id, label, model: r.model, kind, key, dailyLimit: r.dailyLimit, limitedUntil: r.limitedUntil, limitReason: r.limitReason, uses: { background: r.useBackground, waiting: r.useWaiting, taps: r.useTaps } }]
        : [];
    });
}

/** A learner's Gemini chain: their own entries, then the server's they may use. */
function chain(userId: number): Link[] {
  const access = serverAccess(userId);
  const server = access === "none" ? [] : links(null).filter((l) => access === "all" || l.kind === "free");
  return [...links(userId), ...server];
}

/** Whether Gemini voices can be used by this learner at all. */
export function geminiReady(userId: number): boolean {
  return chain(userId).length > 0;
}

/** The Azure key and region this learner's Azure voices use: their own, else the server's if they may. */
export function azureKeyFor(userId: number): { region: string; key: string } | "server" | null {
  const own = db.select().from(k).where(and(eq(k.userId, userId), eq(k.provider, "azure"))).get();
  const key = own && decryptSecret(own.keyEnc);
  if (own && key && own.region) return { region: own.region, key };
  // The server's Azure (its free tier) counts as free for sharing.
  return serverAccess(userId) === "none" ? null : "server";
}

/** A learner's own keys and order, and what of the server's comes after. */
export function myVoices(userId: number): MyVoices {
  const access = serverAccess(userId);
  return {
    canStoreKey: isEncryptionAvailable,
    keys: listKeys(userId),
    entries: listEntries(userId),
    server: {
      entries:
        access === "none"
          ? []
          : links(null)
              .filter((l) => access === "all" || l.kind === "free")
              .map((l) => ({ label: l.label, model: l.model, kind: l.kind, uses: (Object.keys(l.uses) as TtsPurpose[]).filter((p) => l.uses[p]) })),
      azure: access !== "none",
    },
  };
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

const reserveOf = (userId: number) => getSettings(userId).audiobooks.reserve;

/** How many requests background audio may still make today for this learner (for the auto queue). */
export function backgroundRoom(userId: number, now = Date.now()): number {
  const reserve = reserveOf(userId);
  const day = googleDay(now);
  return chain(userId)
    .filter((l) => l.uses.background && !(l.limitedUntil && l.limitedUntil > now / 1000))
    .reduce((n, l) => n + Math.max(0, Math.floor(l.dailyLimit * (1 - reserve)) - usedToday(l.id, day)), 0);
}

const WHAT: Record<TtsPurpose, string> = { background: "background audio", waiting: "listening", taps: "reading words aloud" };

/**
 * Make one request for this learner with the first entry that may: `run`
 * gets the key and model and returns the result and the seconds of audio it
 * made. Throws TtsRateLimited (when the first one comes back) when every
 * entry meant for this purpose is at a limit, TtsUnavailable when none is.
 */
export async function withGemini<T>(
  purpose: TtsPurpose,
  userId: number,
  run: (cfg: { key: string; model: string }) => Promise<{ result: T; seconds: number }>,
): Promise<T> {
  const list = chain(userId).filter((l) => l.uses[purpose]);
  if (!list.length) throw new TtsUnavailable(`No Gemini key is set to be used for ${WHAT[purpose]}`);
  const reserve = reserveOf(userId);
  let first: { at: number; reason: string } | null = null;
  const later = (at: number, reason: string) => {
    if (!first || at < first.at) first = { at, reason };
  };
  for (const l of list) {
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
      later(nextReset(now), `The rest of today's Gemini requests are kept for you (${Math.round(reserve * 100)}%)`);
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
  const reason = list.length > 1 ? `Every Gemini key for ${WHAT[purpose]} is at its limit; the first back: ${f?.reason ?? "unknown"}` : (f?.reason ?? "Gemini's limit is used up for now");
  throw new TtsRateLimited(reason, f ? Math.max(f.at - nowS(), 1) : null);
}
