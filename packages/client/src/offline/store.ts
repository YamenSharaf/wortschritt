import type { SyncOp } from "@mdb/shared";

/**
 * Where the app keeps the learner's data offline: documents by collection and
 * id (as the server sends them in the change feed), plus the outbox of actions
 * waiting to be pushed, in order. The app backs it with SQLite; tests use
 * memoryOfflineStore. Values are plain JSON.
 */
export type Collection =
  /** SyncStory by story id. */
  | "stories"
  /** SeriesView by series id. */
  | "series"
  /** VocabEntry by word. */
  | "vocab"
  /** VocabGroup by id. */
  | "groups"
  /** Note by id. */
  | "notes"
  /** ExerciseItem[] (the learner's generated items) by set id. */
  | "generated"
  /** Everything else: the cursor, library, settings, stats, … (see offline/sync.ts). */
  | "meta";

export const DATA_COLLECTIONS: Collection[] = ["stories", "series", "vocab", "groups", "notes", "generated"];

export type OfflineStore = {
  get<T>(collection: Collection, id: string): Promise<T | null>;
  all<T>(collection: Collection): Promise<T[]>;
  put(collection: Collection, id: string, value: unknown): Promise<void>;
  remove(collection: Collection, id: string): Promise<void>;
  /** Empty these collections (the outbox stays). */
  clear(collections: Collection[]): Promise<void>;
  /** Run `fn` as one unit: all of its writes or none. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /** Queue an action (after any already queued). */
  enqueue(op: SyncOp): Promise<void>;
  /** Queued actions, oldest first. */
  pending(limit?: number): Promise<SyncOp[]>;
  pendingCount(): Promise<number>;
  /** Replace a queued action in place (null drops it), e.g. to merge edits. */
  replacePending(opId: string, op: SyncOp | null): Promise<void>;
  /** Drop actions the server has answered. */
  dequeue(opIds: string[]): Promise<void>;

  /** Forget everything, the outbox too (sign-out, another server). */
  reset(): Promise<void>;
};

/** An OfflineStore in memory (tests; data is copied in and out like a database would). */
export function memoryOfflineStore(): OfflineStore {
  const docs = new Map<string, Map<string, string>>();
  let outbox: SyncOp[] = [];
  const col = (c: Collection) => {
    let m = docs.get(c);
    if (!m) docs.set(c, (m = new Map()));
    return m;
  };
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    async get<T>(c: Collection, id: string) {
      const v = col(c).get(id);
      return v === undefined ? null : (JSON.parse(v) as T);
    },
    async all<T>(c: Collection) {
      return [...col(c).values()].map((v) => JSON.parse(v) as T);
    },
    async put(c, id, value) {
      col(c).set(id, JSON.stringify(value));
    },
    async remove(c, id) {
      col(c).delete(id);
    },
    async clear(cs) {
      for (const c of cs) docs.delete(c);
    },
    async transaction(fn) {
      // Roll back on failure, like the database would.
      const saved = new Map([...docs].map(([k, m]) => [k, new Map(m)]));
      const savedOutbox = [...outbox];
      try {
        return await fn();
      } catch (e) {
        docs.clear();
        for (const [k, m] of saved) docs.set(k, m);
        outbox = savedOutbox;
        throw e;
      }
    },
    async enqueue(op) {
      outbox.push(copy(op));
    },
    async pending(limit) {
      return copy(limit === undefined ? outbox : outbox.slice(0, limit));
    },
    async pendingCount() {
      return outbox.length;
    },
    async replacePending(opId, op) {
      const i = outbox.findIndex((o) => o.opId === opId);
      if (i < 0) return;
      if (op) outbox[i] = copy(op);
      else outbox.splice(i, 1);
    },
    async dequeue(opIds) {
      const drop = new Set(opIds);
      outbox = outbox.filter((o) => !drop.has(o.opId));
    },
    async reset() {
      docs.clear();
      outbox = [];
    },
  };
}
