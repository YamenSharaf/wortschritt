import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Settings } from "@mdb/shared";

/** Single-row settings blob (id is always 1). */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  data: text("data", { mode: "json" }).$type<Settings>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** One row per answered item — the raw event log progress is derived from. */
export const attempts = sqliteTable("attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  setId: text("set_id").notNull(),
  itemId: text("item_id").notNull(),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  answeredAt: integer("answered_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Content added at runtime via the import screen. Git-versioned JSON in
 * CONTENT_DIR is the other source; the API merges both.
 */
export const importedContent = sqliteTable("imported_content", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["exercise", "cheatsheet"] }).notNull(),
  data: text("data", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
