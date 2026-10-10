import type { SyncOp } from "@mdb/shared";
import type { Collection, OfflineStore } from "./store";

type Param = string | number | null;

/**
 * The bits of an async SQLite connection the store uses; expo-sqlite's
 * SQLiteDatabase has them (the app), and tests wrap better-sqlite3.
 */
export type SqlDb = {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: Param[]): Promise<unknown>;
  getFirstAsync<T>(source: string, ...params: Param[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: Param[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};

/**
 * The offline store in SQLite: one table of JSON documents by collection and
 * id (as the change feed sends them), and the outbox in order. The database
 * opens (and its tables are made) on first use.
 */
export function sqliteOfflineStore(open: () => Promise<SqlDb>): OfflineStore {
  let opened: Promise<SqlDb> | null = null;
  const db = () =>
    (opened ??= (async () => {
      const d = await open();
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS docs (
          col TEXT NOT NULL,
          id TEXT NOT NULL,
          v TEXT NOT NULL,
          PRIMARY KEY (col, id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS outbox (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          op_id TEXT NOT NULL UNIQUE,
          op TEXT NOT NULL
        );
      `);
      return d;
    })());

  return {
    async get<T>(col: Collection, id: string) {
      const row = await (await db()).getFirstAsync<{ v: string }>("SELECT v FROM docs WHERE col = ? AND id = ?", col, id);
      return row ? (JSON.parse(row.v) as T) : null;
    },
    async all<T>(col: Collection) {
      const rows = await (await db()).getAllAsync<{ v: string }>("SELECT v FROM docs WHERE col = ?", col);
      return rows.map((r) => JSON.parse(r.v) as T);
    },
    async put(col, id, value) {
      await (await db()).runAsync(
        "INSERT INTO docs (col, id, v) VALUES (?, ?, ?) ON CONFLICT (col, id) DO UPDATE SET v = excluded.v",
        col,
        id,
        JSON.stringify(value),
      );
    },
    async remove(col, id) {
      await (await db()).runAsync("DELETE FROM docs WHERE col = ? AND id = ?", col, id);
    },
    async clear(cols) {
      const d = await db();
      for (const col of cols) await d.runAsync("DELETE FROM docs WHERE col = ?", col);
    },
    async transaction<T>(fn: () => Promise<T>) {
      let result!: T;
      await (await db()).withTransactionAsync(async () => {
        result = await fn();
      });
      return result;
    },
    async enqueue(op) {
      await (await db()).runAsync("INSERT INTO outbox (op_id, op) VALUES (?, ?)", op.opId, JSON.stringify(op));
    },
    async pending(limit) {
      const d = await db();
      const rows =
        limit === undefined
          ? await d.getAllAsync<{ op: string }>("SELECT op FROM outbox ORDER BY seq")
          : await d.getAllAsync<{ op: string }>("SELECT op FROM outbox ORDER BY seq LIMIT ?", limit);
      return rows.map((r) => JSON.parse(r.op) as SyncOp);
    },
    async pendingCount() {
      const row = await (await db()).getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM outbox");
      return row?.n ?? 0;
    },
    async replacePending(opId, op) {
      const d = await db();
      if (op) await d.runAsync("UPDATE outbox SET op = ? WHERE op_id = ?", JSON.stringify(op), opId);
      else await d.runAsync("DELETE FROM outbox WHERE op_id = ?", opId);
    },
    async dequeue(opIds) {
      const d = await db();
      for (let i = 0; i < opIds.length; i += 200) {
        const chunk = opIds.slice(i, i + 200);
        await d.runAsync(`DELETE FROM outbox WHERE op_id IN (${chunk.map(() => "?").join(",")})`, ...chunk);
      }
    },
    async reset() {
      await (await db()).execAsync("DELETE FROM docs; DELETE FROM outbox;");
    },
  };
}
