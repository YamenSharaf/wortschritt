import { memoryOfflineStore, type OfflineStore } from "@mdb/client";

/**
 * The web preview keeps the offline store in memory (expo-sqlite on the web
 * needs cross-origin isolation); the app uses SQLite (offlineStore.native.ts).
 */
export function createOfflineStore(): OfflineStore {
  return memoryOfflineStore();
}
