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

/** One row per completed practice run (a pass through an exercise set). */
export const exerciseRuns = sqliteTable("exercise_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  setId: text("set_id").notNull(),
  setTitle: text("set_title").notNull(),
  total: integer("total").notNull(),
  answered: integer("answered").notNull(),
  correct: integer("correct").notNull(),
  results: text("results", { mode: "json" })
    .$type<Record<string, boolean>>()
    .notNull(),
  finishedAt: integer("finished_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Last-viewed timestamp per cheat sheet (one row per sheet). */
export const sheetViews = sqliteTable("sheet_views", {
  sheetId: text("sheet_id").primaryKey(),
  title: text("title").notNull(),
  viewedAt: integer("viewed_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Saved vocabulary. `word` is the lowercased key; `display` keeps the form
 *  shown to the user. Translation + examples are cached so we don't re-query
 *  the AI on every view. */
export const vocab = sqliteTable("vocab", {
  word: text("word").primaryKey(),
  display: text("display").notNull(),
  translation: text("translation").notNull(),
  examples: text("examples", { mode: "json" })
    .$type<{ de: string; en: string }[]>()
    .notNull(),
  createdAt: integer("created_at")
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
