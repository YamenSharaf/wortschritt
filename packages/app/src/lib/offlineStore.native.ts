import * as SQLite from "expo-sqlite";
import { sqliteOfflineStore, type OfflineStore, type SqlDb } from "@mdb/client";

/** The learner's data on the device, in SQLite (see @mdb/client's sqliteOfflineStore). */
export function createOfflineStore(name = "wortschritt.db"): OfflineStore {
  return sqliteOfflineStore(async (): Promise<SqlDb> => SQLite.openDatabaseAsync(name));
}
