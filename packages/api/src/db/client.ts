import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env";
import * as schema from "./schema";

const dbPath = resolve(env.DATABASE_PATH);
const dir = dirname(dbPath);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

/**
 * Create tables if they don't exist. For a single-user app this is simpler and
 * more robust than shipping a migration runner; `drizzle-kit generate` is still
 * wired up (see drizzle.config.ts) for when you want versioned migrations.
 */
export function ensureSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      correct INTEGER NOT NULL,
      answered_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_attempts_answered_at ON attempts(answered_at);
    CREATE INDEX IF NOT EXISTS idx_attempts_set ON attempts(set_id);
    CREATE TABLE IF NOT EXISTS imported_content (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS exercise_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id TEXT NOT NULL,
      set_title TEXT NOT NULL,
      total INTEGER NOT NULL,
      answered INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      results TEXT NOT NULL,
      finished_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_runs_set ON exercise_runs(set_id);
    CREATE INDEX IF NOT EXISTS idx_runs_finished ON exercise_runs(finished_at);
    CREATE TABLE IF NOT EXISTS exercise_progress (
      set_id TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      results TEXT NOT NULL,
      responses TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS sheet_views (
      sheet_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      viewed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_sheet_views_viewed ON sheet_views(viewed_at);
    CREATE TABLE IF NOT EXISTS vocab (
      word TEXT PRIMARY KEY,
      display TEXT NOT NULL,
      translation TEXT NOT NULL,
      examples TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_vocab_created ON vocab(created_at);
    CREATE TABLE IF NOT EXISTS vocab_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS vocab_group_members (
      group_id INTEGER NOT NULL,
      word TEXT NOT NULL,
      PRIMARY KEY (group_id, word)
    );
    CREATE INDEX IF NOT EXISTS idx_vgm_word ON vocab_group_members(word);
    CREATE TABLE IF NOT EXISTS vocab_stats (
      word TEXT PRIMARY KEY,
      known INTEGER NOT NULL DEFAULT 0,
      missed INTEGER NOT NULL DEFAULT 0,
      last_result INTEGER,
      last_studied_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      category TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
    -- Bundled offline dictionary. dict_forms maps every inflected surface form
    -- to its lemma (+ noun gender/plural); dict_gloss holds curated English
    -- meanings keyed by (lowercased lemma, part of speech). Seeded from the
    -- committed assets in db/dictSeed.ts, gated by a version marker in dict_meta.
    CREATE TABLE IF NOT EXISTS dict_forms (
      form TEXT PRIMARY KEY,
      lemma TEXT NOT NULL,
      pos TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT '',
      plural TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS dict_gloss (
      lemma TEXT NOT NULL,
      pos TEXT NOT NULL,
      gloss TEXT NOT NULL,
      PRIMARY KEY (lemma, pos)
    );
    CREATE TABLE IF NOT EXISTS dict_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);
}

export const db = drizzle(sqlite, { schema });
export { schema };
/** Raw better-sqlite3 handle for hot-path prepared statements (dictionary). */
export const rawDb: Database.Database = sqlite;
