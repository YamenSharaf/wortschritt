import { useEffect, useState } from "react";
import type { Preference } from "../storage";
import { useStorage } from "./context";

/**
 * A per-device preference as state: read from the platform's store (at once
 * when it can, else as soon as it answers) and written back on each change.
 */
export function usePreference<T>(pref: Preference<T>): [T, (next: T | ((current: T) => T)) => void] {
  const store = useStorage();
  const read = (raw: string | null) => (raw === null ? pref.fallback : (pref.parse(raw) ?? pref.fallback));
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = store.get(pref.key);
      return raw instanceof Promise ? pref.fallback : read(raw);
    } catch {
      return pref.fallback;
    }
  });

  useEffect(() => {
    let alive = true;
    try {
      const raw = store.get(pref.key);
      if (raw instanceof Promise) raw.then((r) => alive && setValue(read(r))).catch(() => {});
    } catch {
      /* keep the default */
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, pref.key]);

  function set(next: T | ((current: T) => T)) {
    setValue((current) => {
      const v = typeof next === "function" ? (next as (c: T) => T)(current) : next;
      try {
        void Promise.resolve(store.set(pref.key, String(v))).catch(() => {});
      } catch {
        /* not kept: private mode and the like */
      }
      return v;
    });
  }

  return [value, set];
}
