import type { Cheatsheet, ExerciseSet, Favorite, Settings, SyncChanges, SyncStats } from "@mdb/shared";
import type { Api } from "../api";
import { ApiError } from "../http";
import { timers, type TimerId } from "../timers";
import { DATA_COLLECTIONS, type Collection, type OfflineStore } from "./store";

/** What the change feed's library holds, as kept in meta. */
export type LocalLibrary = { version: string; exerciseSets: ExerciseSet[]; cheatsheets: Cheatsheet[]; builtIn: string[] };

/** Keys in the "meta" collection. */
export const META = {
  cursor: "cursor",
  library: "library",
  settings: "settings",
  /** Favorite[], newest first. */
  favorites: "favorites",
  stats: "stats",
  syncedAt: "syncedAt",
  /** + opId: the local id of a note created offline (removed once the server has it). */
  localNote: "localNote:",
  /** + local note id: the server's id for it, once pushed (an open editor may still use the local one). */
  noteAlias: "noteAlias:",
} as const;

export type SyncState = "idle" | "syncing" | "offline" | "error";

export type SyncStatus = {
  state: SyncState;
  /** When the last sync finished (ms since epoch), null before the first. */
  lastSyncAt: number | null;
  /** Actions waiting to be pushed. */
  pending: number;
  /** Bumped whenever a pull changed local data (screens reload on it). */
  revision: number;
  error?: string;
};

/** A failure to reach the server at all (no answer), as opposed to an answer saying no. */
export function isNetworkError(e: unknown): boolean {
  return !(e instanceof ApiError);
}

const PUSH_BATCH = 500;

/**
 * Keeps the local store in step with the server: push the outbox (each op is
 * applied once, whatever the network does), then pull the change feed from
 * the last cursor. One sync runs at a time; asking during one runs another
 * right after. Nothing here decides anything about the learner's data: the
 * server's answers are stored as they are.
 */
export function createSync(o: { api: Api; store: OfflineStore; now?: () => number }) {
  const { api, store } = o;
  const now = o.now ?? Date.now;
  let status: SyncStatus = { state: "idle", lastSyncAt: null, pending: 0, revision: 0 };
  const listeners = new Set<(s: SyncStatus) => void>();
  let running: Promise<SyncStatus> | null = null;
  let again = false;
  let timer: TimerId | null = null;

  function set(patch: Partial<SyncStatus>) {
    status = { ...status, ...patch };
    for (const l of listeners) l(status);
  }

  async function refreshPending() {
    set({ pending: await store.pendingCount() });
  }

  /** Send queued actions until none are left (or the server can't be reached). */
  async function push() {
    for (;;) {
      const ops = await store.pending(PUSH_BATCH);
      if (!ops.length) return;
      const { results } = await api.syncPush(ops);
      const answered = new Set(results.map((r) => r.opId));
      for (const r of results) {
        const op = ops.find((x) => x.opId === r.opId);
        if (op?.type !== "noteCreate") continue;
        // The server has it now under its own id; the pull brings it back.
        const key = META.localNote + op.opId;
        const localId = await store.get<string>("meta", key);
        if (localId) {
          await store.remove("notes", localId);
          if (r.noteId) await store.put("meta", META.noteAlias + localId, r.noteId);
        }
        await store.remove("meta", key);
      }
      // Every answered op is done, applied or not (the server never wants it again).
      await store.dequeue([...answered]);
      await refreshPending();
      if (answered.size < ops.length) return; // the rest next time
    }
  }

  async function apply(c: SyncChanges) {
    await store.transaction(async () => {
      if (c.full) await store.clear(DATA_COLLECTIONS);
      const put = (col: Collection, id: string, v: unknown) => store.put(col, id, v);
      for (const s of c.stories) await put("stories", s.story.id, s);
      for (const s of c.series) await put("series", s.id, s);
      for (const v of c.vocab) await put("vocab", v.word, v);
      for (const g of c.groups) await put("groups", String(g.id), g);
      for (const n of c.notes) await put("notes", n.id, n);
      for (const g of c.generated) await put("generated", g.setId, g.items);
      const gone: [Collection, string[]][] = [
        ["stories", c.deleted.stories],
        ["series", c.deleted.series],
        ["vocab", c.deleted.vocab],
        ["groups", c.deleted.groups],
        ["notes", c.deleted.notes],
        ["generated", c.deleted.generated],
      ];
      for (const [col, ids] of gone) for (const id of ids) await store.remove(col, id);
      if (c.library) await store.put("meta", META.library, c.library satisfies LocalLibrary);
      if (c.settings) await store.put("meta", META.settings, c.settings satisfies Settings);
      if (c.favorites) await store.put("meta", META.favorites, c.favorites satisfies Favorite[]);
      await store.put("meta", META.stats, c.stats satisfies SyncStats);
      await store.put("meta", META.cursor, c.cursor);
    });
  }

  /** Fetch changes since the last cursor (all of them: the feed comes in pages). */
  async function pull() {
    for (;;) {
      const since = (await store.get<string>("meta", META.cursor)) ?? undefined;
      const lib = await store.get<LocalLibrary>("meta", META.library);
      const c = await api.syncChanges({ since, library: lib?.version });
      await apply(c);
      if (!c.more) break;
    }
  }

  async function run(): Promise<SyncStatus> {
    set({ state: "syncing", error: undefined });
    try {
      await push();
      await pull();
      const at = now();
      await store.put("meta", META.syncedAt, at);
      // Stats come with every pull, so screens reload after each one.
      set({ state: "idle", lastSyncAt: at, revision: status.revision + 1 });
    } catch (e) {
      set(isNetworkError(e) ? { state: "offline" } : { state: "error", error: e instanceof Error ? e.message : String(e) });
    }
    await refreshPending();
    return status;
  }

  /** Push, then pull. Calls during a sync share it and run one more after. */
  function sync(): Promise<SyncStatus> {
    if (running) {
      again = true;
      return running;
    }
    running = run().finally(() => {
      running = null;
      if (again) {
        again = false;
        void sync();
      }
    });
    return running;
  }

  return {
    sync,
    /** Sync soon (after a local write), once for a burst of writes. */
    schedule(delayMs = 800) {
      if (timer) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        void sync();
      }, delayMs);
    },
    status: () => status,
    subscribe(listener: (s: SyncStatus) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Read what's stored (on start: the last sync time and pending count). */
    async load() {
      const at = await store.get<number>("meta", META.syncedAt);
      set({ lastSyncAt: at, pending: await store.pendingCount() });
      return status;
    },
    /** Whether a first sync has filled the store (reads are local from then on). */
    async hasData() {
      return (await store.get<string>("meta", META.cursor)) !== null;
    },
    refreshPending,
    stop() {
      if (timer) timers.clearTimeout(timer);
      timer = null;
      listeners.clear();
    },
  };
}

export type Sync = ReturnType<typeof createSync>;
