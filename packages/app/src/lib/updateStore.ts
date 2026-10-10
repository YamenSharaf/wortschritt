import { useSyncExternalStore } from "react";

/** A newer build of the Android app, as published on GitHub. */
export type Release = { build: number; tag: string; apkUrl: string; size: number };

/** Where the app's own update stands. */
export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current" }
  | { phase: "available"; release: Release }
  | { phase: "downloading"; release: Release; progress: number }
  | { phase: "ready"; release: Release; file: string }
  | { phase: "error"; message: string; release?: Release };

let state: UpdateState = { phase: "idle" };
const listeners = new Set<() => void>();

export function getUpdateState(): UpdateState {
  return state;
}

export function setUpdateState(next: UpdateState) {
  state = next;
  listeners.forEach((l) => l());
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
