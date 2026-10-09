import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import type { Api } from "../api";
import type { Speech } from "../speech";
import { memoryStore, type KeyValueStore } from "../storage";

type Client = { api: Api; speech?: Speech; storage?: KeyValueStore };
const ClientContext = createContext<(Client & { storage: KeyValueStore }) | null>(null);

/**
 * Makes one server's API (see createApi), the platform's speech (see
 * createSpeech) and its per-device storage available to the hooks below it.
 * Without a storage, preferences last until a reload.
 */
export function ClientProvider({ api, speech, storage, children }: Client & { children?: ReactNode }) {
  const value = useMemo(() => ({ api, speech, storage: storage ?? memoryStore() }), [api, speech, storage]);
  return createElement(ClientContext.Provider, { value }, children);
}

function useClient() {
  const client = useContext(ClientContext);
  if (!client) throw new Error("Hooks from @mdb/client/react must be used within ClientProvider");
  return client;
}

export function useApi(): Api {
  return useClient().api;
}

export function useSpeech(): Speech {
  const { speech } = useClient();
  if (!speech) throw new Error("ClientProvider was given no speech");
  return speech;
}

export function useStorage(): KeyValueStore {
  return useClient().storage;
}
