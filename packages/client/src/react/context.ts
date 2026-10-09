import { createContext, createElement, useContext, type ReactNode } from "react";
import type { Api } from "../api";
import type { Speech } from "../speech";

type Client = { api: Api; speech?: Speech };
const ClientContext = createContext<Client | null>(null);

/**
 * Makes one server's API (see createApi) and the platform's speech (see
 * createSpeech) available to the hooks below it.
 */
export function ClientProvider({ api, speech, children }: Client & { children?: ReactNode }) {
  return createElement(ClientContext.Provider, { value: { api, speech } }, children);
}

function useClient(): Client {
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
