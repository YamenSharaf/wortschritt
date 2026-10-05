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
  for (const t of ["settings", "attempts", "vocab", "notes", "imported_content", "dict_forms"]) {
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
  const settings = db.prepare("SELECT data FROM settings WHERE id = 1").get() as {
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
  db.exec("CREATE TABLE settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
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
