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

/** Resumable in-progress position for an exercise set (one row per set;
 *  cleared when the set is finished). */
export const exerciseProgress = sqliteTable("exercise_progress", {
  setId: text("set_id").primaryKey(),
  position: integer("position").notNull(),
  results: text("results", { mode: "json" })
    .$type<Record<string, boolean>>()
    .notNull(),
  responses: text("responses", { mode: "json" })
    .$type<Record<string, string>>()
    .notNull(),
  updatedAt: integer("updated_at")
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
  /** AI-supplied grammatical forms (e.g. the perfect auxiliary). Offline data
   *  fills the rest at read time. Added by migration; null on older rows. */
  forms: text("forms", { mode: "json" }).$type<Record<string, string>>(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Named collections. A word can belong to several groups (many-to-many). */
export const vocabGroups = sqliteTable("vocab_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const vocabGroupMembers = sqliteTable("vocab_group_members", {
  groupId: integer("group_id").notNull(),
  word: text("word").notNull(),
});

/** Flashcard self-assessment tally per word (know / don't-know), kept across
 *  study sessions. `lastResult` is 1 = known, 0 = missed, null = never studied. */
export const vocabStats = sqliteTable("vocab_stats", {
  word: text("word").primaryKey(),
  known: integer("known").notNull().default(0),
  missed: integer("missed").notNull().default(0),
  lastResult: integer("last_result"),
  lastStudiedAt: integer("last_studied_at"),
});

/** Free-form, categorized learning notes (Markdown), auto-saved. */
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Untitled"),
  category: text("category").notNull().default(""),
  body: text("body").notNull().default(""),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at")
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

/** Accounts. `username` is unique case-insensitively (COLLATE NOCASE). */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull(),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Server-side sessions. `id` is the SHA-256 (hex) of the cookie token. */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer("expires_at").notNull(),
});
