import { createContext, createElement, useContext, type ReactNode } from "react";
import type { Api } from "../api";

const ApiContext = createContext<Api | null>(null);

/** Makes one server's API (see createApi) available to the hooks below it. */
export function ApiProvider({ api, children }: { api: Api; children?: ReactNode }) {
  return createElement(ApiContext.Provider, { value: api }, children);
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used within ApiProvider");
  return api;
}
