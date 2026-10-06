import { eq } from "drizzle-orm";
import type { RegistrationStatus } from "@mdb/shared";
import { db, schema } from "../db/client";

/**
 * Self-registration is closed by default. The admin opens it for a fixed
 * window, after which it closes on its own, so it can't be left open by
 * accident on an internet-facing instance.
 */
export const REGISTRATION_WINDOW_S = 24 * 60 * 60;
const KEY = "registration_open_until";

const now = () => Math.floor(Date.now() / 1000);

export function registrationStatus(): RegistrationStatus {
  const row = db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, KEY))
    .get();
  const until = row ? Number(row.value) : 0;
  return until > now() ? { open: true, openUntil: until } : { open: false, openUntil: null };
}

export function setRegistrationOpen(open: boolean): RegistrationStatus {
  if (open) {
    const value = String(now() + REGISTRATION_WINDOW_S);
    db.insert(schema.appSettings)
      .values({ key: KEY, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
      .run();
  } else {
    db.delete(schema.appSettings).where(eq(schema.appSettings.key, KEY)).run();
  }
  return registrationStatus();
}
