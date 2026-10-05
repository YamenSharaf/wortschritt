import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env";
import { runMigrations, type MigrationResult } from "./migrations";
import * as schema from "./schema";

const dbPath = resolve(env.DATABASE_PATH);
const dir = dirname(dbPath);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

/**
 * Bring the schema up to date via the versioned migrations in ./migrations.ts
 * (backing the database up first when there's anything to migrate).
 */
export function ensureSchema(): MigrationResult {
  return runMigrations(sqlite, dbPath);
}

export const db = drizzle(sqlite, { schema });
export { schema };
/** Raw better-sqlite3 handle for hot-path prepared statements (dictionary). */
export const rawDb: Database.Database = sqlite;
