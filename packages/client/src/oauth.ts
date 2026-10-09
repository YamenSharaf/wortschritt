import type { FetchLike } from "./http";
import type { KeyValueStore } from "./storage";

/**
 * Signing an app in to a Wortschritt server (OAuth 2.1, `scope=app`), apart
 * from the browser step: the platform opens the authorize URL (the app with
 * expo-auth-session, which also makes the PKCE pair) and hands back the code.
 * See packages/api/src/auth/oauth.ts for the server side.
 */

export type ServerAuth = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** When the access token runs out (unix seconds). */
  expiresAt: number;
};

/** An error from the token endpoint (`invalid_grant`: sign in again). */
export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const nowS = () => Math.floor(Date.now() / 1000);

/** application/x-www-form-urlencoded, without relying on URLSearchParams. */
const formBody = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

/** The server's OAuth endpoints (its RFC 8414 metadata, not the OpenID path). */
export async function fetchServerAuth(baseUrl: string, fetch: FetchLike): Promise<ServerAuth> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`, { method: "GET" });
  if (!res.ok) throw new Error(`The server didn't describe its sign-in (${res.status}).`);
  const m = await res.json();
  return {
    issuer: m.issuer,
    authorizationEndpoint: m.authorization_endpoint,
    tokenEndpoint: m.token_endpoint,
    registrationEndpoint: m.registration_endpoint,
    revocationEndpoint: m.revocation_endpoint,
  };
}

/** Register this install as a public client; returns its client_id (keep it). */
export async function registerApp(
  auth: ServerAuth,
  fetch: FetchLike,
  o: { redirectUri: string; clientName: string },
): Promise<string> {
  const res = await fetch(auth.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: o.clientName,
      redirect_uris: [o.redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new OAuthError(body.error ?? "registration_failed", body.error_description ?? "Couldn't register the app.");
  return body.client_id as string;
}

async function tokenRequest(auth: ServerAuth, fetch: FetchLike, params: Record<string, string>): Promise<OAuthTokens> {
  const res = await fetch(auth.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new OAuthError(body.error ?? "server_error", body.error_description ?? `Sign-in failed (${res.status}).`);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: nowS() + Number(body.expires_in ?? 3600),
  };
}

/** Trade the code from the browser step for tokens. */
export function exchangeCode(
  auth: ServerAuth,
  fetch: FetchLike,
  o: { clientId: string; code: string; codeVerifier: string; redirectUri: string },
): Promise<OAuthTokens> {
  return tokenRequest(auth, fetch, {
    grant_type: "authorization_code",
    client_id: o.clientId,
    code: o.code,
    code_verifier: o.codeVerifier,
    redirect_uri: o.redirectUri,
  });
}

export function refreshTokens(
  auth: ServerAuth,
  fetch: FetchLike,
  o: { clientId: string; refreshToken: string },
): Promise<OAuthTokens> {
  return tokenRequest(auth, fetch, { grant_type: "refresh_token", client_id: o.clientId, refresh_token: o.refreshToken });
}

/** End the connection on the server (sign-out). Never throws. */
export async function revokeToken(auth: ServerAuth, fetch: FetchLike, o: { clientId: string; token: string }): Promise<void> {
  try {
    await fetch(auth.revocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ client_id: o.clientId, token: o.token }),
    });
  } catch {
    /* offline: the token runs out on its own */
  }
}

/**
 * The signed-in app's tokens: kept in a (secure) store, refreshed shortly
 * before they run out, one refresh at a time (a foreground request and a
 * background sync must not both rotate the refresh token). Only a refresh the
 * server rejects (`invalid_grant`) signs out; being offline doesn't.
 */
export function createTokenSession(o: {
  store: KeyValueStore;
  /** Ask the server for a new pair (refreshTokens with this app's client id). */
  refresh: (refreshToken: string) => Promise<OAuthTokens>;
  /** The server ended the connection: forget the user (the app shows sign-in). */
  onSignedOut?: () => void;
  key?: string;
  /** Refresh this many seconds before the access token runs out. */
  leeway?: number;
}) {
  const key = o.key ?? "mdb-tokens";
  const leeway = o.leeway ?? 60;
  let tokens: OAuthTokens | null = null;
  let loaded = false;
  let inFlight: Promise<boolean> | null = null;

  async function load() {
    if (loaded) return tokens;
    const raw = await o.store.get(key);
    try {
      tokens = raw ? (JSON.parse(raw) as OAuthTokens) : null;
    } catch {
      tokens = null;
    }
    loaded = true;
    return tokens;
  }

  async function save(next: OAuthTokens | null) {
    tokens = next;
    loaded = true;
    await o.store.set(key, next ? JSON.stringify(next) : null);
  }

  /** Get a new pair now (shared by everyone asking at once). False if it couldn't. */
  function refreshNow(): Promise<boolean> {
    inFlight ??= (async () => {
      const current = await load();
      if (!current) return false;
      try {
        await save(await o.refresh(current.refreshToken));
        return true;
      } catch (e) {
        if (e instanceof OAuthError && e.code === "invalid_grant") {
          await save(null);
          o.onSignedOut?.();
        }
        return false;
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  /** A usable access token, refreshing first when it's about to run out. */
  async function accessToken(): Promise<string | null> {
    const t = await load();
    if (!t) return null;
    if (t.expiresAt - leeway <= nowS()) await refreshNow();
    return tokens?.accessToken ?? null;
  }

  return {
    load,
    /** Keep a freshly signed-in pair. */
    signIn: (t: OAuthTokens) => save(t),
    /** Forget the tokens (after revoking them on the server). */
    clear: () => save(null),
    /** The current pair, as loaded (null: signed out). */
    current: () => tokens,
    refreshNow,
    /** The bearer header for createApi's `headers` (empty when signed out). */
    async headers(): Promise<Record<string, string>> {
      const t = await accessToken();
      return t ? { authorization: `Bearer ${t}` } : {};
    },
    accessToken,
  };
}

export type TokenSession = ReturnType<typeof createTokenSession>;
