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
  /** Try to get a fresh access token after a 401; true when one was obtained. */
  refresh: () => Promise<boolean>;
};

let session: NativeSession | null = null;

export function setNativeSession(s: NativeSession | null): void {
  session = s;
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
    return fetch(apiUrl(path), { ...init, headers, credentials: "omit" });
  };
  const res = await send();
  if (res.status !== 401 || !(await session.refresh())) return res;
  return send();
}
