import type { KeyValueStore } from "@mdb/client";

/**
 * This browser's localStorage, for per-device preferences. It answers at once
 * (unlike the app's AsyncStorage); private modes may refuse it, and then
 * nothing is kept.
 */
export const localStore = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* not kept */
    }
  },
} satisfies KeyValueStore;
