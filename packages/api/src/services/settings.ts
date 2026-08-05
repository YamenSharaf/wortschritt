import { eq } from "drizzle-orm";
import { settingsSchema, type Settings } from "@mdb/shared";
import { db, schema } from "../db/client";

export function getSettings(): Settings {
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.id, 1))
    .get();
  if (!row) return settingsSchema.parse({});
  // Re-parse so newly added fields get their defaults.
  return settingsSchema.parse(row.data);
}

export function saveSettings(next: Settings): Settings {
  const value = settingsSchema.parse(next);
  db.insert(schema.settings)
    .values({ id: 1, data: value })
    .onConflictDoUpdate({
      target: schema.settings.id,
      set: { data: value },
    })
    .run();
  return value;
}
