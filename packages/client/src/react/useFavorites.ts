import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Favorite, FavoriteKind } from "@mdb/shared";
import type { Api } from "../api";
import { useApi } from "./context";

/**
 * Starred sets and sheets, shared by every screen that uses them (a star on a
 * list shows on Home at once). Toggling is optimistic: the star changes now,
 * and the server's (or the offline store's) list replaces it after.
 */
type Store = {
  list: Favorite[] | null;
  error: Error | null;
  listeners: Set<() => void>;
  loading: Promise<void> | null;
};

const stores = new WeakMap<Api, Store>();
function storeFor(api: Api): Store {
  let s = stores.get(api);
  if (!s) stores.set(api, (s = { list: null, error: null, listeners: new Set(), loading: null }));
  return s;
}
const emit = (s: Store) => s.listeners.forEach((l) => l());

function load(api: Api, s: Store, force = false): Promise<void> {
  if (s.loading && !force) return s.loading;
  s.loading = api
    .favorites()
    .then((list) => {
      s.list = list;
      s.error = null;
    })
    .catch((e) => {
      s.error = e instanceof Error ? e : new Error(String(e));
    })
    .finally(() => {
      s.loading = null;
      emit(s);
    });
  return s.loading;
}

export function useFavorites(opts: { reloadKey?: unknown } = {}) {
  const api = useApi();
  const s = storeFor(api);
  const list = useSyncExternalStore(
    (l) => (s.listeners.add(l), () => void s.listeners.delete(l)),
    () => s.list,
  );
  // Load once, and again whenever `reloadKey` changes (the app passes its sync revision).
  useEffect(() => {
    void load(api, s, opts.reloadKey !== undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, opts.reloadKey]);

  const isFavorite = useCallback(
    (kind: FavoriteKind, id: string) => !!list?.some((f) => f.kind === kind && f.id === id),
    [list],
  );

  const toggle = useCallback(
    async (kind: FavoriteKind, id: string) => {
      const before = s.list ?? [];
      const on = !before.some((f) => f.kind === kind && f.id === id);
      s.list = on
        ? [{ kind, id, createdAt: Math.floor(Date.now() / 1000) }, ...before]
        : before.filter((f) => !(f.kind === kind && f.id === id));
      emit(s);
      try {
        s.list = await api.setFavorite(kind, id, on);
      } catch (e) {
        s.list = before;
        throw e;
      } finally {
        emit(s);
      }
    },
    [api, s],
  );

  return { list: list ?? [], ready: list !== null, isFavorite, toggle };
}
