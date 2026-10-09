/**
 * What differs between the web build and the native (Android) build.
 *
 * The web build talks to its own origin with the session cookie. The native
 * build (VITE_TARGET=native) ships inside the APK, so it talks to a
 * user-entered server with an OAuth bearer token instead. Everything else in
 * the SPA stays the same; only `req()` and asset URLs go through here.
 */

export const IS_NATIVE = import.meta.env.VITE_TARGET === "native";

/** Supplies the server and token in the native build (set up by native auth). */
export type NativeSession = {
  /** Server origin, e.g. "https://wortschritt.example.com" (no trailing slash). */
  serverUrl: string;
  /** Current access token, or null when signed out. */
  accessToken: () => Promise<string | null>;
  /** After `failed` got a 401: true when there is a newer token to retry with. */
  refresh: (failed: string | null) => Promise<boolean>;
  /** Revoke and forget the tokens (log out). */
  signOut: () => Promise<void>;
};

let session: NativeSession | null = null;

export function setNativeSession(s: NativeSession | null): void {
  session = s;
}

/**
 * /api/auth/me answers "signed out" rather than 401 for a refused token, so the
 * app refreshes explicitly when it still holds tokens. True: ask again.
 */
export async function nativeRetryAuth(): Promise<boolean> {
  const token = await session?.accessToken();
  return Boolean(session && token && (await session.refresh(token)));
}

/** Log out of the native app (the web logs out with its session cookie). */
export async function nativeSignOut(): Promise<void> {
  await session?.signOut();
}

// Sign-in state changes made outside React (OAuth callback, a refresh token
// the server no longer accepts), so the auth context can ask /api/auth/me again.
const authListeners = new Set<() => void>();
export function onAuthChanged(listener: () => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}
export function notifyAuthChanged(): void {
  for (const l of authListeners) l();
}

/** The native build has a server to talk to (else it shows the connect screen). */
export function hasNativeServer(): boolean {
  return session !== null;
}

/** The server the native build talks to, for display. */
export function nativeServerUrl(): string | null {
  return session?.serverUrl ?? null;
}

/** Absolute URL for an API path: unchanged on the web, on the server natively. */
export function apiUrl(path: string): string {
  return IS_NATIVE && session ? session.serverUrl + path : path;
}

/** Fetch an API path with the platform's credentials (cookie or bearer token). */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!IS_NATIVE) return fetch(path, { credentials: "same-origin", ...init });
  if (!session) return new Response(null, { status: 401 });
  const send = async () => {
    const token = await session!.accessToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    // Bearer only: the server's CORS for the app never allows credentials.
    return { token, res: await fetch(apiUrl(path), { ...init, headers, credentials: "omit" }) };
  };
  const first = await send();
  if (first.res.status !== 401 || !first.token || !(await session.refresh(first.token))) return first.res;
  return (await send()).res;
}

/**
 * A URL an <img> or <audio> can load for an API path. Those can't send a bearer
 * token, so the native build fetches the file itself and hands back a blob URL;
 * call `release` when done with it. On the web it's the path, as before.
 */
export async function authedUrl(path: string): Promise<{ url: string; release: () => void }> {
  if (!IS_NATIVE) return { url: path, release: () => {} };
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const url = URL.createObjectURL(await res.blob());
  return { url, release: () => URL.revokeObjectURL(url) };
}
