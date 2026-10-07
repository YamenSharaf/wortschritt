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
  {
    version: 3,
    // Per-user data. Every learner table gains a user_id (deleting a user
    // deletes their data); tables keyed by word / set / sheet are rebuilt with
    // (user_id, …) keys so two users can't collide. Existing rows go to the
    // admin. Content (imported_content) stays shared but records its owner.
    name: "per-user-data",
    up(db) {
      // Owner for the pre-existing rows. A database upgraded straight from
      // v1 has no users yet: create a placeholder admin (empty hash = can't
      // log in) that auth/users.ts completes from ADMIN_USERNAME/APP_PASSWORD.
      db.exec(`
        INSERT INTO users (username, password_hash, role)
          SELECT 'admin', '', 'admin' WHERE NOT EXISTS (SELECT 1 FROM users);
      `);
      const OWNER = `(SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)`;
      const USER_FK = `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`;

      /** Rebuild `table` with a new definition, copying rows via `select`. */
      const rebuild = (table: string, columns: string, select: string, indexes: string[]) => {
        db.exec(`
          CREATE TABLE ${table}_new (${columns});
          INSERT INTO ${table}_new ${select};
          DROP TABLE ${table};
          ALTER TABLE ${table}_new RENAME TO ${table};
          ${indexes.map((i) => `${i};`).join("\n")}
        `);
      };

      rebuild(
        "settings",
        `user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
         data TEXT NOT NULL,
         updated_at INTEGER NOT NULL DEFAULT (unixepoch())`,
        `SELECT ${OWNER}, data, updated_at FROM settings WHERE id = 1`,
        [],
      );
      rebuild(
        "attempts",
        `id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id ${USER_FK},
         set_id TEXT NOT NULL,
         item_id TEXT NOT NULL,
         correct INTEGER NOT NULL,
         answered_at INTEGER NOT NULL DEFAULT (unixepoch())`,
        `SELECT id, ${OWNER}, set_id, item_id, correct, answered_at FROM attempts`,
        [
          "CREATE INDEX idx_attempts_user_answered ON attempts(user_id, answered_at)",
          "CREATE INDEX idx_attempts_user_set ON attempts(user_id, set_id)",
        ],
      );
      rebuild(
        "exercise_runs",
        `id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id ${USER_FK},
         set_id TEXT NOT NULL,
         set_title TEXT NOT NULL,
         total INTEGER NOT NULL,
         answered INTEGER NOT NULL,
         correct INTEGER NOT NULL,
         results TEXT NOT NULL,
         finished_at INTEGER NOT NULL DEFAULT (unixepoch())`,
        `SELECT id, ${OWNER}, set_id, set_title, total, answered, correct, results, finished_at
         FROM exercise_runs`,
        [
          "CREATE INDEX idx_runs_user_set ON exercise_runs(user_id, set_id)",
          "CREATE INDEX idx_runs_user_finished ON exercise_runs(user_id, finished_at)",
        ],
      );
      rebuild(
        "exercise_progress",
        `user_id ${USER_FK},
         set_id TEXT NOT NULL,
         position INTEGER NOT NULL,
         results TEXT NOT NULL,
         responses TEXT NOT NULL,
         updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
         PRIMARY KEY (user_id, set_id)`,
        `SELECT ${OWNER}, set_id, position, results, responses, updated_at FROM exercise_progress`,
        [],
      );
      rebuild(
        "sheet_views",
        `user_id ${USER_FK},
         sheet_id TEXT NOT NULL,
         title TEXT NOT NULL,
         viewed_at INTEGER NOT NULL DEFAULT (unixepoch()),
         PRIMARY KEY (user_id, sheet_id)`,
        `SELECT ${OWNER}, sheet_id, title, viewed_at FROM sheet_views`,
        ["CREATE INDEX idx_sheet_views_user_viewed ON sheet_views(user_id, viewed_at)"],
      );
      rebuild(
        "vocab",
        `user_id ${USER_FK},
         word TEXT NOT NULL,
         display TEXT NOT NULL,
         translation TEXT NOT NULL,
         examples TEXT NOT NULL,
         forms TEXT,
         created_at INTEGER NOT NULL DEFAULT (unixepoch()),
         PRIMARY KEY (user_id, word)`,
        `SELECT ${OWNER}, word, display, translation, examples, forms, created_at FROM vocab`,
        ["CREATE INDEX idx_vocab_user_created ON vocab(user_id, created_at)"],
      );
      rebuild(
        "vocab_groups",
        `id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id ${USER_FK},
         name TEXT NOT NULL,
         created_at INTEGER NOT NULL DEFAULT (unixepoch())`,
        `SELECT id, ${OWNER}, name, created_at FROM vocab_groups`,
        ["CREATE INDEX idx_vocab_groups_user ON vocab_groups(user_id)"],
      );
      rebuild(
        "vocab_group_members",
        `group_id INTEGER NOT NULL,
         user_id ${USER_FK},
         word TEXT NOT NULL,
         PRIMARY KEY (group_id, word)`,
        `SELECT group_id, ${OWNER}, word FROM vocab_group_members`,
        ["CREATE INDEX idx_vgm_user_word ON vocab_group_members(user_id, word)"],
      );
      rebuild(
        "vocab_stats",
        `user_id ${USER_FK},
         word TEXT NOT NULL,
         known INTEGER NOT NULL DEFAULT 0,
         missed INTEGER NOT NULL DEFAULT 0,
         last_result INTEGER,
         last_studied_at INTEGER,
         PRIMARY KEY (user_id, word)`,
        `SELECT ${OWNER}, word, known, missed, last_result, last_studied_at FROM vocab_stats`,
        [],
      );
      rebuild(
        "notes",
        `id TEXT PRIMARY KEY,
         user_id ${USER_FK},
         title TEXT NOT NULL DEFAULT 'Untitled',
         category TEXT NOT NULL DEFAULT '',
         body TEXT NOT NULL DEFAULT '',
         created_at INTEGER NOT NULL DEFAULT (unixepoch()),
         updated_at INTEGER NOT NULL DEFAULT (unixepoch())`,
        `SELECT id, ${OWNER}, title, category, body, created_at, updated_at FROM notes`,
        ["CREATE INDEX idx_notes_user_updated ON notes(user_id, updated_at)"],
      );

      db.exec(`
        -- Shown on the admin's Users screen.
        ALTER TABLE users ADD COLUMN last_login_at INTEGER;
        UPDATE users SET last_login_at =
          (SELECT MAX(created_at) FROM sessions WHERE sessions.user_id = users.id);

        -- Shared library: keep rows when their importer is deleted.
        ALTER TABLE imported_content
          ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
        UPDATE imported_content SET created_by = ${OWNER};

        -- Instance-wide settings (e.g. registration window), key → value.
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 4,
    // Each user's own AI tutor endpoint. The API key is encrypted
    // (assistant/secrets.ts) and never sent back to the browser.
    name: "per-user-ai-settings",
    up(db) {
      db.exec(`
        CREATE TABLE ai_settings (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          base_url TEXT NOT NULL,
          model TEXT NOT NULL,
          api_key_enc TEXT,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
      `);
    },
  },
  {
    version: 5,
    // Several AI providers per user (one key each) and an ordered list of
    // provider + model entries tried in turn ("try A, then B"). The single
    // ai_settings row becomes provider 1 with model entry 1.
    name: "ai-providers-and-fallback-order",
    up(db) {
      db.exec(`
        CREATE TABLE ai_providers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          api_key_enc TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX idx_ai_providers_user ON ai_providers(user_id);
        CREATE TABLE ai_models (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider_id INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
          model TEXT NOT NULL,
          position INTEGER NOT NULL
        );
        CREATE INDEX idx_ai_models_user ON ai_models(user_id, position);

        INSERT INTO ai_providers (user_id, name, base_url, api_key_enc)
          SELECT user_id,
                 CASE WHEN base_url LIKE 'https://openrouter.ai/%' THEN 'OpenRouter'
                      WHEN base_url LIKE 'https://api.openai.com/%' THEN 'OpenAI'
                      ELSE 'My endpoint' END,
                 base_url, api_key_enc
          FROM ai_settings;
        INSERT INTO ai_models (user_id, provider_id, model, position)
          SELECT s.user_id, p.id, s.model, 0
          FROM ai_settings s JOIN ai_providers p ON p.user_id = s.user_id;
        DROP TABLE ai_settings;
      `);
    },
  },
  {
    version: 6,
    // Personal API tokens for scripts and integrations (e.g. an MCP server).
    // Stored as SHA-256 only; `prefix` lets the user recognise a token.
    name: "api-tokens",
    up(db) {
      db.exec(`
        CREATE TABLE api_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          prefix TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_used_at INTEGER
        );
        CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
      `);
    },
  },
  {
    version: 7,
    // OAuth for MCP clients (e.g. Claude's connectors): registered clients,
    // one-time authorization codes, and the access each user granted. Codes
    // and tokens are stored as SHA-256 only.
    name: "oauth",
    up(db) {
      db.exec(`
        CREATE TABLE oauth_clients (
          client_id TEXT PRIMARY KEY,
          client_name TEXT NOT NULL,
          client_uri TEXT,
          redirect_uris TEXT NOT NULL,
          secret_hash TEXT,
          metadata_document INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          fetched_at INTEGER
        );
        CREATE TABLE oauth_codes (
          code_hash TEXT PRIMARY KEY,
          client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          redirect_uri TEXT NOT NULL,
          code_challenge TEXT NOT NULL,
          resource TEXT NOT NULL,
          scope TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE oauth_grants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
          scope TEXT NOT NULL,
          resource TEXT NOT NULL,
          access_hash TEXT NOT NULL UNIQUE,
          access_expires_at INTEGER NOT NULL,
          refresh_hash TEXT NOT NULL UNIQUE,
          refresh_expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_used_at INTEGER
        );
        CREATE INDEX idx_oauth_grants_user ON oauth_grants(user_id);
      `);
    },
  },
  {
    version: 8,
    // History: what was answered and how it was judged (older rows: NULL /
    // 'auto'), and a log of flashcard reviews next to the per-word tally.
    name: "history",
    up(db) {
      addColumn(db, "attempts", "response", "TEXT");
      addColumn(db, "attempts", "grading", "TEXT NOT NULL DEFAULT 'auto'");
      db.exec(`
        CREATE TABLE vocab_reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          word TEXT NOT NULL,
          known INTEGER NOT NULL,
          reviewed_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX idx_vocab_reviews_user_time ON vocab_reviews(user_id, reviewed_at);
      `);
    },
  },
  {
    version: 9,
    // Stories: private reading texts (validated JSON), with where the learner
    // stopped reading and when they finished.
    name: "stories",
    up(db) {
      db.exec(`
        CREATE TABLE stories (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          id TEXT NOT NULL,
          data TEXT NOT NULL,
          progress REAL NOT NULL DEFAULT 0,
          read_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (user_id, id)
        );
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
