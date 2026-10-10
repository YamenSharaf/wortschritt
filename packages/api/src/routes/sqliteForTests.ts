import Database from "better-sqlite3";
import type { SqlDb } from "@mdb/client";

/** better-sqlite3 behind the async interface expo-sqlite offers (what the app passes). */
export function sqliteForTests(): SqlDb {
  const db = new Database(":memory:");
  return {
    execAsync: async (source) => void db.exec(source),
    runAsync: async (source, ...params) => db.prepare(source).run(...params),
    getFirstAsync: async <T>(source: string, ...params: (string | number | null)[]) =>
      (db.prepare(source).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T>(source: string, ...params: (string | number | null)[]) => db.prepare(source).all(...params) as T[],
    async withTransactionAsync(task) {
      db.exec("BEGIN");
      try {
        await task();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
