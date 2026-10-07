import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";

/**
 * The server-wide time zone that days are counted in ("answered today", the
 * activity timeline). Set by the admin; defaults to the container's TZ, or UTC.
 */
const KEY = "timezone";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function getTimezone(): string {
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).get();
  if (row && isValidTimezone(row.value)) return row.value;
  const envTz = process.env.TZ;
  return envTz && isValidTimezone(envTz) ? envTz : "UTC";
}

export function setTimezone(tz: string): string {
  if (!isValidTimezone(tz)) throw new Error(`unknown time zone "${tz}"`);
  db.insert(schema.appSettings)
    .values({ key: KEY, value: tz })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: tz } })
    .run();
  return tz;
}

/** Local time minus UTC, in ms, for `tz` at instant `ms`. */
function offsetMs(tz: string, ms: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Unix seconds of local midnight on a calendar date in `tz`. */
export function zonedMidnight(year: number, month: number, day: number, tz: string): number {
  const local = Date.UTC(year, month - 1, day);
  // Two passes, so a DST change between the guess and midnight is accounted for.
  let guess = local - offsetMs(tz, local);
  guess = local - offsetMs(tz, guess);
  return Math.floor(guess / 1000);
}

/** "YYYY-MM-DD" of an instant (unix seconds) in `tz`. */
export function dayKey(sec: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    sec * 1000,
  );
}

/** Unix seconds of the local midnight starting the day that contains `sec`. */
export function startOfDay(sec: number, tz: string): number {
  const [y, m, d] = dayKey(sec, tz).split("-").map(Number);
  return zonedMidnight(y!, m!, d!, tz);
}

/** Unix seconds of local midnight of a "YYYY-MM-DD" date, plus `addDays`. */
export function dateStart(date: string, tz: string, addDays = 0): number {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y!, m! - 1, d! + addDays));
  return zonedMidnight(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), tz);
}
