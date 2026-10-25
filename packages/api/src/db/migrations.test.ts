import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import { LATEST_VERSION, migrations, runMigrations } from "./migrations";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mdb-migrations-"));
  dbPath = join(dir, "app.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const backups = () => readdirSync(dir).filter((f) => f.includes(".bak-"));
const version = (db: Database.Database) =>
  db.pragma("user_version", { simple: true }) as number;

/**
 * A database as the app wrote it before versioned migrations: user_version 0,
 * and an early `vocab` table without the later-added `forms` column.
 */
function legacyDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE attempts (id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id TEXT NOT NULL, item_id TEXT NOT NULL, correct INTEGER NOT NULL,
      answered_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE vocab (word TEXT PRIMARY KEY, display TEXT NOT NULL,
      translation TEXT NOT NULL, examples TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled',
      category TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()));

    INSERT INTO settings (id, data) VALUES (1, '{"displayName":"Yamen","level":"B1"}');
    INSERT INTO attempts (set_id, item_id, correct) VALUES ('perfekt', 'p1', 1), ('perfekt', 'p2', 0);
    INSERT INTO vocab (word, display, translation, examples)
      VALUES ('haus', 'das Haus', 'house', '[]');
    INSERT INTO notes (id, title, body) VALUES ('n1', 'Dativ', 'mit + Dativ');
  `);
  return db;
}

test("fresh database: migrates to latest without a backup", () => {
  const db = new Database(dbPath);
  const result = runMigrations(db, dbPath);

  assert.deepEqual(result, { from: 0, to: LATEST_VERSION, backup: null });
  assert.equal(version(db), LATEST_VERSION);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => (r as { name: string }).name);
  for (const t of ["settings", "attempts", "vocab", "notes", "imported_content", "dict_forms", "users", "sessions", "api_tokens", "oauth_clients", "oauth_codes", "oauth_grants", "vocab_reviews", "stories", "dict_cache", "story_translations", "series"]) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  assert.deepEqual(backups(), []);
  db.close();
});

test("legacy database: keeps every row, adds missing columns, writes a backup", () => {
  const db = legacyDb(dbPath);
  const result = runMigrations(db, dbPath);

  assert.equal(result.from, 0);
  assert.equal(result.to, LATEST_VERSION);
  assert.equal(version(db), LATEST_VERSION);

  // Data survives untouched.
  const count = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  assert.equal(count("attempts"), 2);
  assert.equal(count("vocab"), 1);
  assert.equal(count("notes"), 1);
  const settings = db.prepare("SELECT data FROM settings").get() as {
    data: string;
  };
  assert.equal(JSON.parse(settings.data).displayName, "Yamen");

  // The later-added column now exists.
  const vocabCols = db
    .prepare("PRAGMA table_info(vocab)")
    .all()
    .map((c) => (c as { name: string }).name);
  assert.ok(vocabCols.includes("forms"));

  // The backup is a usable pre-migration copy.
  assert.ok(result.backup);
  assert.equal(backups().length, 1);
  const snap = new Database(result.backup, { readonly: true });
  assert.equal(version(snap), 0);
  assert.equal(
    (snap.prepare("SELECT COUNT(*) AS n FROM attempts").get() as { n: number }).n,
    2,
  );
  snap.close();
  db.close();
});

test("up-to-date database: second run is a no-op with no new backup", () => {
  const db = legacyDb(dbPath);
  runMigrations(db, dbPath);
  const again = runMigrations(db, dbPath);

  assert.deepEqual(again, { from: LATEST_VERSION, to: LATEST_VERSION, backup: null });
  assert.equal(backups().length, 1);
  db.close();
});

test("database from a newer app version: refuses to start", () => {
  const db = new Database(dbPath);
  db.pragma(`user_version = ${LATEST_VERSION + 1}`);

  assert.throws(() => runMigrations(db, dbPath), /newer version of the app/);
  assert.equal(version(db), LATEST_VERSION + 1);
  db.close();
});

test("no backup path (e.g. :memory:): migrates without writing files", () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)",
  );
  const result = runMigrations(db, null);

  assert.equal(result.backup, null);
  assert.equal(version(db), LATEST_VERSION);
  db.close();
});

test("failing migration: rolls back to the previous version, data intact", () => {
  const db = legacyDb(dbPath);
  runMigrations(db, dbPath);
  const broken = [
    ...migrations,
    {
      version: LATEST_VERSION + 1,
      name: "broken",
      up(d: Database.Database) {
        d.exec("DELETE FROM attempts");
        throw new Error("boom");
      },
    },
  ];

  assert.throws(() => runMigrations(db, dbPath, broken), /boom/);
  assert.equal(version(db), LATEST_VERSION);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM attempts").get() as { n: number }).n,
    2,
  );
  db.close();
});

const ownerIds = (db: Database.Database, table: string) =>
  (db.prepare(`SELECT DISTINCT user_id AS u FROM ${table}`).all() as { u: number }[]).map(
    (r) => r.u,
  );

test("v0 → latest: data goes to a placeholder admin that can't log in yet", () => {
  const db = legacyDb(dbPath);
  runMigrations(db, dbPath);

  const users = db.prepare("SELECT id, role, password_hash AS h FROM users").all() as {
    id: number;
    role: string;
    h: string;
  }[];
  assert.equal(users.length, 1);
  assert.equal(users[0]!.role, "admin");
  assert.equal(users[0]!.h, "", "placeholder is completed from env at boot");
  for (const t of ["attempts", "vocab", "notes", "settings"]) {
    assert.deepEqual(ownerIds(db, t), [users[0]!.id], t);
  }
  db.close();
});

test("v2 → v3: every row is assigned to the existing admin, nothing lost", () => {
  const db = legacyDb(dbPath);
  // Bring the legacy DB to v2 and add the Phase 1 admin, as on the live server.
  runMigrations(db, dbPath, migrations.slice(0, 2));
  db.exec(`
    DELETE FROM users;
    INSERT INTO users (id, username, password_hash, role) VALUES (7, 'yamen', 'scrypt$x', 'admin');
    INSERT INTO exercise_runs (set_id, set_title, total, answered, correct, results)
      VALUES ('perfekt', 'Perfekt', 10, 10, 8, '{}');
    INSERT INTO exercise_progress (set_id, position, results, responses)
      VALUES ('perfekt', 3, '{}', '{}');
    INSERT INTO sheet_views (sheet_id, title) VALUES ('perfekt', 'Perfekt');
    INSERT INTO vocab_groups (id, name) VALUES (1, 'Küche');
    INSERT INTO vocab_group_members (group_id, word) VALUES (1, 'haus');
    INSERT INTO vocab_stats (word, known, missed) VALUES ('haus', 3, 1);
    INSERT INTO imported_content (id, kind, data) VALUES ('mine', 'exercise', '{}');
  `);
  const before = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const tables = [
    "settings", "attempts", "exercise_runs", "exercise_progress", "sheet_views",
    "vocab", "vocab_groups", "vocab_group_members", "vocab_stats", "notes",
  ];
  const counts = Object.fromEntries(tables.map((t) => [t, before(t)]));

  runMigrations(db, dbPath);

  assert.equal(version(db), LATEST_VERSION);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 1);
  for (const t of tables) {
    assert.equal(before(t), counts[t], `${t} row count`);
    assert.deepEqual(ownerIds(db, t), counts[t] ? [7] : [], `${t} owner`);
  }
  const imported = db.prepare("SELECT created_by AS c FROM imported_content").get() as {
    c: number;
  };
  assert.equal(imported.c, 7);
  // The same word can now exist once per user.
  db.exec(`
    INSERT INTO users (id, username, password_hash, role) VALUES (8, 'anna', 'x', 'user');
    INSERT INTO vocab (user_id, word, display, translation, examples)
      VALUES (8, 'haus', 'das Haus', 'house', '[]');
  `);
  // And deleting a user deletes their data.
  db.exec("DELETE FROM users WHERE id = 8");
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM vocab WHERE user_id = 8").get() as { n: number }).n,
    0,
  );
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("v4 → v5: a saved AI endpoint becomes provider 1 with model entry 1", () => {
  const db = legacyDb(dbPath);
  runMigrations(db, dbPath, migrations.slice(0, 4));
  db.exec(`
    DELETE FROM users;
    INSERT INTO users (id, username, password_hash, role) VALUES (7, 'yamen', 'scrypt$x', 'admin');
    INSERT INTO users (id, username, password_hash, role) VALUES (8, 'anna', 'scrypt$x', 'user');
    INSERT INTO ai_settings (user_id, base_url, model, api_key_enc)
      VALUES (7, 'https://ai.example.com/v1', 'my-model', 'v1.a.b.c'),
             (8, 'https://openrouter.ai/api/v1', 'openai/gpt-4o-mini', NULL);
  `);
  runMigrations(db, dbPath);

  const providers = db
    .prepare("SELECT user_id AS u, name, base_url AS url, api_key_enc AS k FROM ai_providers ORDER BY user_id")
    .all();
  assert.deepEqual(providers, [
    { u: 7, name: "My endpoint", url: "https://ai.example.com/v1", k: "v1.a.b.c" },
    { u: 8, name: "OpenRouter", url: "https://openrouter.ai/api/v1", k: null },
  ]);
  const models = db
    .prepare(
      "SELECT m.user_id AS u, m.model, m.position AS pos, p.user_id AS pu FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id ORDER BY m.user_id",
    )
    .all();
  assert.deepEqual(models, [
    { u: 7, model: "my-model", pos: 0, pu: 7 },
    { u: 8, model: "openai/gpt-4o-mini", pos: 0, pu: 8 },
  ]);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'ai_settings'").get() &&
      (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'ai_settings'").get() as { n: number }).n,
    0,
    "old table dropped",
  );
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("v7 → v8: attempts keep their rows, with no response and auto grading", () => {
  const db = legacyDb(dbPath);
  runMigrations(db, dbPath, migrations.slice(0, 7));
  runMigrations(db, dbPath);

  const rows = db.prepare("SELECT item_id, correct, response, grading FROM attempts ORDER BY id").all();
  assert.deepEqual(rows, [
    { item_id: "p1", correct: 1, response: null, grading: "auto" },
    { item_id: "p2", correct: 0, response: null, grading: "auto" },
  ]);
  const owner = (db.prepare("SELECT id FROM users").get() as { id: number }).id;
  db.prepare("INSERT INTO vocab_reviews (user_id, word, known) VALUES (?, 'haus', 1)").run(owner);
  db.exec("DELETE FROM users");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM vocab_reviews").get() as { n: number }).n, 0, "cascades");
  db.close();
});

test("v23: the one Gemini key stored before becomes the first of the order, used for everything", () => {
  const db = new Database(":memory:");
  runMigrations(db, null, migrations.filter((m) => m.version <= 22));
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('tts.gemini', ?)").run(JSON.stringify({ key: "enc:abc", model: "gemini-3.8-flash-lite-tts" }));
  runMigrations(db, null);

  assert.deepEqual(db.prepare("SELECT label, kind, key_enc AS k, user_id AS u FROM tts_keys").all(), [{ label: "Gemini", kind: "paid", k: "enc:abc", u: null }]);
  assert.deepEqual(
    db.prepare("SELECT model, position, use_background AS b, use_waiting AS w, use_taps AS t, daily_limit AS d FROM tts_entries").all(),
    [{ model: "gemini-3.8-flash-lite-tts", position: 0, b: 1, w: 1, t: 1, d: 100 }],
  );
  assert.equal(db.prepare("SELECT 1 FROM app_settings WHERE key = 'tts.gemini'").get(), undefined, "the old setting is gone");
  db.close();
});
