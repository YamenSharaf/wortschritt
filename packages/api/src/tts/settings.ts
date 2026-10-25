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

const BACKGROUND = "tts.background";
const EDGE_FALLBACK = "tts.edgeFallback";

/** Background audio: off unless turned on; it keeps `reserve` of each entry's daily requests for people. */
export function backgroundSettings(): { enabled: boolean; reserve: number } {
  try {
    const v = JSON.parse(readSetting(BACKGROUND) ?? "{}") as { enabled?: boolean; reserve?: number };
    return { enabled: v.enabled === true, reserve: typeof v.reserve === "number" ? Math.min(Math.max(v.reserve, 0), 0.9) : 0.2 };
  } catch {
    return { enabled: false, reserve: 0.2 };
  }
}
export const setBackgroundSettings = (v: { enabled: boolean; reserve: number }) => writeSetting(BACKGROUND, JSON.stringify(v));

/** Taps fall back to Edge's Katja when every Gemini entry is used up. */
export const edgeFallback = () => readSetting(EDGE_FALLBACK) === "1";
export const setEdgeFallback = (on: boolean) => writeSetting(EDGE_FALLBACK, on ? "1" : null);
