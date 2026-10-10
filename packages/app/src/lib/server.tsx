import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetch as expoFetch } from "expo/fetch";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Image } from "expo-image";
import {
  createApi,
  createOfflineApi,
  createSync,
  createTokenSession,
  exchangeCode,
  fetchServerAuth,
  OAuthError,
  refreshTokens,
  registerApp,
  revokeToken,
  type Api,
  type FetchLike,
  type ResponseLike,
  type OfflineStore,
  type ServerAuth,
  type Sync,
  type TokenSession,
} from "@mdb/client";
import { APP_NAME } from "@mdb/shared";
import { createOfflineStore } from "./offlineStore";
import { deviceStore, secretStore } from "./storage";

/** The API version this app speaks (the server's `minClient` must not exceed it). */
const CLIENT_API = 1;
const SERVER_KEY = "mdb-server";
const AUTH_KEY = "mdb-server-auth";

/** The app's own redirect (RFC 8252 private-use scheme); the web preview uses its origin. */
const redirectUri = AuthSession.makeRedirectUri({ native: "eu.yamen.wortschritt:/oauth/callback", path: "oauth/callback" });

/** expo/fetch (streams responses, which SSE needs) as @mdb/client's fetch. */
export const appFetch: FetchLike = (url, init) =>
  expoFetch(url, init as Parameters<typeof expoFetch>[1]) as unknown as Promise<ResponseLike>;

export type ServerStatus = "loading" | "no-server" | "signed-out" | "signed-in";

type ServerState = {
  status: ServerStatus;
  /** The server's origin, e.g. https://wortschritt.example.com. */
  server: string | null;
  /** What screens use: offline-first (reads from the store once synced, writes queued when offline). */
  api: Api | null;
  /** Keeps the store in step with the server (see lib/sync.tsx). */
  sync: Sync | null;
  /** The learner's data on this device. */
  store: OfflineStore;
  /** Check and keep a server address; throws a readable message when it isn't one. */
  connect: (address: string, opts?: { allowHttp?: boolean }) => Promise<void>;
  /** Sign in through the server's page in a browser tab. */
  signIn: () => Promise<void>;
  /** End this connection on the server and here (and forget the learner's data on this device). */
  signOut: () => Promise<void>;
  /** Sign out and forget the server (to connect to another). */
  disconnect: () => Promise<void>;
};

const ServerContext = createContext<ServerState | null>(null);

/** "wort.example.com" → "https://wort.example.com"; drops paths and a trailing slash. */
export function normalizeServer(address: string, allowHttp = false): string {
  const raw = address.trim();
  if (!raw) throw new Error("Enter your server's address.");
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("That isn't a web address.");
  }
  if (url.protocol === "http:" && !allowHttp) throw new Error("Use https, or allow http for a server on your own network.");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("That isn't a web address.");
  return url.origin;
}

function clientIdKey(server: string) {
  return `mdb-client-id:${server}|${redirectUri}`;
}

export function ServerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServerStatus>("loading");
  const [server, setServer] = useState<string | null>(null);
  const [auth, setAuth] = useState<ServerAuth | null>(null);

  const session: TokenSession | null = useMemo(() => {
    if (!server || !auth) return null;
    return createTokenSession({
      store: secretStore,
      key: `mdb-tokens:${server}`,
      refresh: async (refreshToken) => {
        const clientId = await deviceStore.get(clientIdKey(server));
        if (!clientId) throw new OAuthError("invalid_grant", "This install isn't registered with the server.");
        return refreshTokens(auth, appFetch, { clientId, refreshToken });
      },
      onSignedOut: () => setStatus("signed-out"),
    });
  }, [server, auth]);

  const store = useMemo(() => createOfflineStore(), []);
  const online = useMemo(
    () =>
      server && session
        ? createApi({ baseUrl: server, fetch: appFetch, headers: session.headers, onUnauthorized: session.refreshNow })
        : null,
    [server, session],
  );
  const sync = useMemo(() => (online ? createSync({ api: online, store }) : null), [online, store]);
  useEffect(() => () => sync?.stop(), [sync]);
  const api = useMemo(() => (online && sync ? createOfflineApi({ api: online, store, sync }) : null), [online, sync, store]);

  // On start: the saved server, its sign-in endpoints, and whether we hold tokens.
  useEffect(() => {
    (async () => {
      const saved = await deviceStore.get(SERVER_KEY);
      if (!saved) return setStatus("no-server");
      const cached = await deviceStore.get(AUTH_KEY);
      const known = cached ? (JSON.parse(cached) as ServerAuth) : await fetchServerAuth(saved, appFetch).catch(() => null);
      setServer(saved);
      setAuth(known);
      if (!known) return setStatus("signed-out");
    })().catch(() => setStatus("no-server"));
  }, []);
  useEffect(() => {
    if (!session) return;
    session.load().then((t) => setStatus(t ? "signed-in" : "signed-out"));
  }, [session]);

  const connect = useCallback(async (address: string, opts: { allowHttp?: boolean } = {}) => {
    const origin = normalizeServer(address, opts.allowHttp);
    let info: { api?: number; minClient?: number; appName?: string };
    try {
      const res = await appFetch(`${origin}/api/version`, { method: "GET" });
      info = await res.json();
    } catch {
      throw new Error("Couldn't reach that server. Check the address and your connection.");
    }
    if (info.appName !== APP_NAME) throw new Error(`That doesn't look like a ${APP_NAME} server.`);
    if ((info.minClient ?? 1) > CLIENT_API) throw new Error("This server needs a newer version of the app.");
    const meta = await fetchServerAuth(origin, appFetch);
    await deviceStore.set(SERVER_KEY, origin);
    await deviceStore.set(AUTH_KEY, JSON.stringify(meta));
    setAuth(meta);
    setServer(origin);
    setStatus("signed-out");
  }, []);

  const signIn = useCallback(async () => {
    if (!server || !auth || !session) return;
    // A fresh registration per sign-in: the server prunes unused ones, so an
    // id kept from long ago could be gone (and would fail inside the browser).
    const clientId = await registerApp(auth, appFetch, { redirectUri, clientName: APP_NAME });
    const request = new AuthSession.AuthRequest({ clientId, redirectUri, scopes: ["app"], usePKCE: true });
    const result = await request.promptAsync({ authorizationEndpoint: auth.authorizationEndpoint });
    if (result.type === "error") throw new Error(result.params.error_description ?? "Sign-in failed.");
    if (result.type !== "success") return; // closed or cancelled
    const tokens = await exchangeCode(auth, appFetch, {
      clientId,
      code: result.params.code!,
      codeVerifier: request.codeVerifier!,
      redirectUri,
    });
    await deviceStore.set(clientIdKey(server), clientId);
    await session.signIn(tokens);
    setStatus("signed-in");
  }, [server, auth, session]);

  const signOut = useCallback(async () => {
    if (!server || !auth || !session) return;
    // Send what's waiting first: the local data goes with the sign-out.
    await sync?.sync();
    const t = await session.load();
    const clientId = await deviceStore.get(clientIdKey(server));
    if (t && clientId) await revokeToken(auth, appFetch, { clientId, token: t.refreshToken });
    await session.clear();
    await store.reset();
    await Image.clearDiskCache().catch(() => false);
    await Image.clearMemoryCache().catch(() => false);
    setStatus("signed-out");
  }, [server, auth, session, store, sync]);

  const disconnect = useCallback(async () => {
    await signOut();
    await deviceStore.set(SERVER_KEY, null);
    await deviceStore.set(AUTH_KEY, null);
    setServer(null);
    setAuth(null);
    setStatus("no-server");
  }, [signOut]);

  const value = useMemo(
    () => ({ status, server, api, sync, store, connect, signIn, signOut, disconnect }),
    [status, server, api, sync, store, connect, signIn, signOut, disconnect],
  );
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServer(): ServerState {
  const s = useContext(ServerContext);
  if (!s) throw new Error("useServer must be used within ServerProvider");
  return s;
}

// The web preview completes the sign-in popup on the redirect page.
WebBrowser.maybeCompleteAuthSession();
