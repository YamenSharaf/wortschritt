import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";

/** The server's read-aloud settings, kept in app_settings. */

export function readSetting(key: string): string | null {
  return db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get()?.value ?? null;
}
export function writeSetting(key: string, value: string | null): void {
  if (value === null) {
    db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run();
    return;
  }
  db.insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
    .run();
}

const SHARE = "tts.share";
const EDGE_FALLBACK = "tts.edgeFallback";

/** Who may use the server's voice keys: everyone (the default), everyone but only its free keys, or admins only. */
export function serverShare(): "all" | "free" | "admins" {
  const v = readSetting(SHARE);
  return v === "free" || v === "admins" ? v : "all";
}
export const setServerShare = (v: "all" | "free" | "admins") => writeSetting(SHARE, v === "all" ? null : v);

/** Taps fall back to Edge's Katja when every Gemini entry is used up. */
export const edgeFallback = () => readSetting(EDGE_FALLBACK) === "1";
export const setEdgeFallback = (on: boolean) => writeSetting(EDGE_FALLBACK, on ? "1" : null);
