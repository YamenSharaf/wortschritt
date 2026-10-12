import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { Settings } from "@mdb/shared";
import type { Api } from "../api";
import { avatarFor, shuffleSeed, type Avatar, type AvatarStyle } from "../avatar";
import { useApi } from "./context";
import { useAuth } from "./useAuth";

/**
 * The signed-in user's icon, and changing it (pattern or letter, shuffle).
 * Shared by every screen showing it, so a change shows everywhere at once.
 */
type Store = { settings: Settings | null; listeners: Set<() => void>; loading: Promise<void> | null };
const stores = new WeakMap<Api, Store>();
function storeFor(api: Api): Store {
  let s = stores.get(api);
  if (!s) stores.set(api, (s = { settings: null, listeners: new Set(), loading: null }));
  return s;
}
const emit = (s: Store) => s.listeners.forEach((l) => l());

export function useAvatar(opts: { reloadKey?: unknown } = {}): {
  avatar: Avatar;
  style: AvatarStyle;
  setStyle: (style: AvatarStyle) => Promise<void>;
  shuffle: () => Promise<void>;
} {
  const api = useApi();
  const { user } = useAuth();
  const s = storeFor(api);
  const settings = useSyncExternalStore(
    (l) => (s.listeners.add(l), () => void s.listeners.delete(l)),
    () => s.settings,
  );
  useEffect(() => {
    if (s.loading && opts.reloadKey === undefined) return;
    s.loading = api
      .settings()
      .then((v) => void (s.settings = v))
      .catch(() => {})
      .finally(() => ((s.loading = null), emit(s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, opts.reloadKey]);

  const key = user?.username ?? "";
  const style = settings?.avatar.style ?? "pattern";
  const seed = settings?.avatar.seed ?? 0;
  const name = settings?.displayName.trim() || key;
  const avatar = useMemo(() => avatarFor({ key, name, style, seed }), [key, name, style, seed]);

  const save = useCallback(
    async (change: Partial<Settings["avatar"]>) => {
      // Start from the server's current settings so other fields aren't overwritten.
      const current = await api.settings();
      const next = { ...current, avatar: { ...current.avatar, ...change } };
      s.settings = next;
      emit(s);
      s.settings = await api.saveSettings(next);
      emit(s);
    },
    [api, s],
  );

  return {
    avatar,
    style,
    setStyle: (st) => save({ style: st }),
    shuffle: () => save({ seed: shuffleSeed(seed), style: "pattern" }),
  };
}
