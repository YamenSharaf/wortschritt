import { sql } from "drizzle-orm";
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Series, Settings, Story, WordDetails } from "@mdb/shared";

/** Per-user settings blob (one row per user). */
export const settings = sqliteTable("settings", {
  userId: integer("user_id").primaryKey(),
  data: text("data", { mode: "json" }).$type<Settings>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** One row per answered item — the raw event log progress is derived from. */
export const attempts = sqliteTable("attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  setId: text("set_id").notNull(),
  itemId: text("item_id").notNull(),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  /** What the learner typed or chose (null on rows before v8). */
  response: text("response"),
  /** auto | ai | self | ungraded — see `answerGrading`. */
  grading: text("grading", { enum: ["auto", "ai", "self", "ungraded"] }).notNull().default("auto"),
  answeredAt: integer("answered_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** One row per completed practice run (a pass through an exercise set). */
export const exerciseRuns = sqliteTable("exercise_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
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
  userId: integer("user_id").notNull(),
  setId: text("set_id").notNull(),
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
}, (t) => [primaryKey({ columns: [t.userId, t.setId] })]);

/** Last-viewed timestamp per cheat sheet (one row per sheet). */
export const sheetViews = sqliteTable("sheet_views", {
  userId: integer("user_id").notNull(),
  sheetId: text("sheet_id").notNull(),
  title: text("title").notNull(),
  viewedAt: integer("viewed_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => [primaryKey({ columns: [t.userId, t.sheetId] })]);

/** Saved vocabulary. `word` is the lowercased key; `display` keeps the form
 *  shown to the user. Translation + examples are cached so we don't re-query
 *  the AI on every view. */
export const vocab = sqliteTable("vocab", {
  userId: integer("user_id").notNull(),
  word: text("word").notNull(),
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
}, (t) => [primaryKey({ columns: [t.userId, t.word] })]);

/** Named collections. A word can belong to several groups (many-to-many). */
export const vocabGroups = sqliteTable("vocab_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const vocabGroupMembers = sqliteTable("vocab_group_members", {
  groupId: integer("group_id").notNull(),
  userId: integer("user_id").notNull(),
  word: text("word").notNull(),
}, (t) => [primaryKey({ columns: [t.groupId, t.word] })]);

/** Flashcard self-assessment tally per word (know / don't-know), kept across
 *  study sessions. `lastResult` is 1 = known, 0 = missed, null = never studied. */
export const vocabStats = sqliteTable("vocab_stats", {
  userId: integer("user_id").notNull(),
  word: text("word").notNull(),
  known: integer("known").notNull().default(0),
  missed: integer("missed").notNull().default(0),
  lastResult: integer("last_result"),
  lastStudiedAt: integer("last_studied_at"),
}, (t) => [primaryKey({ columns: [t.userId, t.word] })]);

/** One row per flashcard answer (the tally above is the running total). */
export const vocabReviews = sqliteTable("vocab_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  word: text("word").notNull(),
  known: integer("known", { mode: "boolean" }).notNull(),
  reviewedAt: integer("reviewed_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Free-form, categorized learning notes (Markdown), auto-saved. */
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
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
  /** Who imported it (null if that user was deleted). */
  createdBy: integer("created_by"),
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
  lastLoginAt: integer("last_login_at"),
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

/** Instance-wide settings, key → value (e.g. `registration_open_until`). */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** A user's AI providers (OpenAI-compatible endpoints); key encrypted. */
export const aiProviders = sqliteTable("ai_providers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKeyEnc: text("api_key_enc"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

/** A user's ordered model list: tried in `position` order (fallback). */
export const aiModels = sqliteTable("ai_models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  providerId: integer("provider_id").notNull(),
  model: text("model").notNull(),
  position: integer("position").notNull(),
});

/** Personal API tokens; `tokenHash` is the SHA-256 (hex) of the token. */
export const apiTokens = sqliteTable("api_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  prefix: text("prefix").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  lastUsedAt: integer("last_used_at"),
});

/** OAuth clients: dynamically registered, or cached Client ID Metadata Documents. */
export const oauthClients = sqliteTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name").notNull(),
  clientUri: text("client_uri"),
  redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull(),
  secretHash: text("secret_hash"),
  /** 1 = the client_id is a URL to its metadata document (CIMD). */
  metadataDocument: integer("metadata_document", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  fetchedAt: integer("fetched_at"),
});

export const oauthCodes = sqliteTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull(),
  userId: integer("user_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource").notNull(),
  scope: text("scope").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/** One per approval: the current access + refresh token pair (rotated on refresh). */
export const oauthGrants = sqliteTable("oauth_grants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  clientId: text("client_id").notNull(),
  scope: text("scope").notNull(),
  resource: text("resource").notNull(),
  accessHash: text("access_hash").notNull(),
  accessExpiresAt: integer("access_expires_at").notNull(),
  refreshHash: text("refresh_hash").notNull(),
  refreshExpiresAt: integer("refresh_expires_at").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  lastUsedAt: integer("last_used_at"),
});

/** A learner's stories (private). `data` is a validated `story`. */
export const stories = sqliteTable("stories", {
  userId: integer("user_id").notNull(),
  id: text("id").notNull(),
  data: text("data", { mode: "json" }).$type<Story>().notNull(),
  /** How far they've scrolled, 0–1. */
  progress: real("progress").notNull().default(0),
  readAt: integer("read_at"),
  /** Set for a chapter of a series (with its 1-based number and summary). */
  seriesId: text("series_id"),
  chapter: integer("chapter"),
  summary: text("summary"),
  /** Cover art: a checked SVG (see `checkCoverSvg`). */
  cover: text("cover"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => [primaryKey({ columns: [t.userId, t.id] })]);

/** Online dictionary lookups, cached (shared). `data` null = not found. */
export const dictCache = sqliteTable("dict_cache", {
  word: text("word").primaryKey(),
  data: text("data", { mode: "json" }).$type<WordDetails>(),
  fetchedAt: integer("fetched_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

/** English lines for a story paragraph (per learner, like the story). */
export const storyTranslations = sqliteTable("story_translations", {
  userId: integer("user_id").notNull(),
  storyId: text("story_id").notNull(),
  paragraphHash: text("paragraph_hash").notNull(),
  lines: text("lines", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => [primaryKey({ columns: [t.userId, t.storyId, t.paragraphHash] })]);

/** A learner's series (books). `data` is a validated `series`. */
export const series = sqliteTable("series", {
  userId: integer("user_id").notNull(),
  id: text("id").notNull(),
  data: text("data", { mode: "json" }).$type<Series>().notNull(),
  /** Cover art: a checked SVG (see `checkCoverSvg`). */
  cover: text("cover"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => [primaryKey({ columns: [t.userId, t.id] })]);

/** Which of a learner's items changed (filled by triggers, see migration 14). */
export const syncLog = sqliteTable("sync_log", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  kind: text("kind").notNull(),
  itemId: text("item_id").notNull(),
  at: integer("at")
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Pushed offline actions already applied (idempotency), with their result. */
export const syncOps = sqliteTable("sync_ops", {
  userId: integer("user_id").notNull(),
  opId: text("op_id").notNull(),
  result: text("result").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => [primaryKey({ columns: [t.userId, t.opId] })]);
