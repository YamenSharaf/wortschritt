import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { SyncStatus } from "@mdb/client";
import { useServer } from "./server";

/** While the app is open, also sync this often (the change feed is cheap when nothing changed). */
const EVERY_MS = 10 * 60 * 1000;
const OWNER = "owner";

type SyncState = {
  status: SyncStatus;
  /** Sync now (pull to refresh); resolves when it's done. */
  syncNow: () => Promise<void>;
};

const idle: SyncStatus = { state: "idle", lastSyncAt: null, pending: 0, revision: 0 };
const SyncContext = createContext<SyncState>({ status: idle, syncNow: async () => {} });

/**
 * Keeps the learner's data on the device in step with the server while
 * signed in: on start, when the app comes back to the front, every few
 * minutes, and soon after each change made here (the offline API schedules
 * that). The data belongs to whoever signed in: another account on this
 * device starts from a clean store.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { sync, store, api } = useServer();
  const [status, setStatus] = useState<SyncStatus>(idle);

  useEffect(() => {
    if (!sync || !api) return;
    const off = sync.subscribe(setStatus);
    let alive = true;
    (async () => {
      setStatus(await sync.load());
      // Whose data is this? (Reaches the server; offline, keep what's there.)
      const me = await api.me().catch(() => null);
      const username = me?.user?.username;
      if (username) {
        const owner = await store.get<string>("meta", OWNER);
        if (owner && owner !== username) await store.reset();
        await store.put("meta", OWNER, username);
      }
      if (alive) await sync.sync();
    })();
    const appState = AppState.addEventListener("change", (s) => s === "active" && void sync.sync());
    const timer = setInterval(() => AppState.currentState === "active" && void sync.sync(), EVERY_MS);
    return () => {
      alive = false;
      off();
      appState.remove();
      clearInterval(timer);
    };
  }, [sync, store, api]);

  const syncNow = useCallback(async () => {
    await sync?.sync();
  }, [sync]);

  return <SyncContext.Provider value={{ status, syncNow }}>{children}</SyncContext.Provider>;
}

/** The sync status (for the indicator and to reload after a sync) and a way to sync now. */
export function useSync(): SyncState {
  return useContext(SyncContext);
}
