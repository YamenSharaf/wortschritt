import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type Database from "better-sqlite3";

/**
 * Versioned schema migrations.
 *
 * The applied version lives in SQLite's built-in `PRAGMA user_version` (0 on a
 * database that predates this runner). On boot, every migration with a higher
 * version runs in order, each in its own transaction together with the version
 * bump — a failing migration leaves the database at the previous version.
 *
 * Before touching a database that already has tables, a consistent copy is
 * written next to it (`<db>.bak-<timestamp>-v<from>`), so a bad upgrade is
 * undone by stopping the app and copying the backup back over the db file.
 *
 * Adding a migration: append `{ version: <last + 1>, name, up }` below. Never
 * edit or reorder one that has shipped. Rebuilding a table (e.g. to change its
 * primary key) is create-new → copy → drop → rename inside `up`.
 */
export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/** How many backups to keep per database; older ones are deleted. */
const KEEP_BACKUPS = 5;

export const migrations: Migration[] = [
  {
    version: 1,
    // The schema as it stood before versioned migrations. Written to be
    // idempotent so it brings both a fresh database and any pre-versioning
    // database (user_version 0) to the same state.
    name: "baseline",
    up(db) {
      db.exec(`
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
          forms TEXT,
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
        CREATE TABLE IF NOT EXISTS dict_verbs (
          lemma TEXT PRIMARY KEY,
          partizip2 TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dict_meta (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        );
      `);
      // Databases created before `vocab.forms` existed.
      addColumn(db, "vocab", "forms", "TEXT");
    },
  },
  {
    version: 2,
    // Accounts + server-side sessions. The first (admin) user is created from
    // env at boot by auth/users.ts, not here, so migrations stay env-free.
    name: "users-and-sessions",
    up(db) {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
          disabled INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        -- id is the SHA-256 of the cookie token, so a leaked database can't be
        -- used to hijack sessions.
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX idx_sessions_user ON sessions(user_id);
        CREATE INDEX idx_sessions_expires ON sessions(expires_at);
      `);
    },
  },
];

export const LATEST_VERSION = migrations[migrations.length - 1]!.version;

export interface MigrationResult {
  from: number;
  to: number;
  /** Path of the pre-migration backup, if one was written. */
  backup: string | null;
}

/**
 * Bring the database up to the latest version. `dbPath` is where backups are
 * written; pass null (e.g. for `:memory:`) to skip them. `list` is overridable
 * for tests only.
 */
export function runMigrations(
  db: Database.Database,
  dbPath: string | null,
  list: Migration[] = migrations,
): MigrationResult {
  const latest = list[list.length - 1]?.version ?? 0;
  const from = db.pragma("user_version", { simple: true }) as number;
  if (from > latest) {
    throw new Error(
      `Database schema is v${from}, but this app only knows up to v${latest}. ` +
        `It was written by a newer version of the app: upgrade the app, or restore ` +
        `a backup (${dbPath ?? "the db file"}.bak-*) taken before that upgrade.`,
    );
  }
  const pending = list.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from, backup: null };

  const backup = dbPath && hasTables(db) ? writeBackup(db, dbPath, from) : null;

  for (const m of pending) {
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  return { from, to: latest, backup };
}

function hasTables(db: Database.Database): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1")
      .get(),
  );
}

/** Consistent snapshot (works under WAL) via VACUUM INTO; prunes old ones. */
function writeBackup(db: Database.Database, dbPath: string, from: number): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `${basename(dbPath)}.bak-`;
  const target = join(dirname(dbPath), `${prefix}${stamp}-v${from}`);
  db.prepare("VACUUM INTO ?").run(target);

  const old = readdirSync(dirname(dbPath))
    .filter((f) => f.startsWith(prefix))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const f of old) {
    const p = join(dirname(dbPath), f);
    if (existsSync(p)) rmSync(p);
  }
  return target;
}

/** Add a column if the table doesn't already have it. */
function addColumn(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
