import { eq } from "drizzle-orm";
import { settingsSchema, type Settings } from "@mdb/shared";
import { db, schema } from "../db/client";

export function getSettings(userId: number): Settings {
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.userId, userId))
    .get();
  if (!row) return settingsSchema.parse({});
  // Re-parse so newly added fields get their defaults.
  return settingsSchema.parse(row.data);
}

export function saveSettings(userId: number, next: Settings): Settings {
  const value = settingsSchema.parse(next);
  db.insert(schema.settings)
    .values({ userId, data: value })
    .onConflictDoUpdate({
      target: schema.settings.userId,
      set: { data: value },
    })
    .run();
  return value;
}
