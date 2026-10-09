/**
 * OAuth 2.1 pieces for the app's sign-in (no I/O, so they're unit-tested).
 * The server's side lives in packages/api/src/auth/oauth.ts.
 */

/** RFC 8252 private-use scheme; Capacitor's default scheme is the app id. */
export const REDIRECT_URI = "eu.yamen.wortschritt:/oauth/callback";
export const CLIENT_NAME = "Wortschritt (Android)";

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Random URL-safe string (32 bytes of entropy → 43 chars). */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** PKCE S256 (RFC 7636): a verifier and its challenge. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** The server's sign-in + consent page, asking for an app (REST API) token. */
export function authorizeUrl(origin: string, p: { clientId: string; challenge: string; state: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: p.state,
    scope: "app",
  });
  return `${origin}/oauth/authorize?${q}`;
}

export type CallbackResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/** Read the redirect back into the app; null when the URL isn't our callback. */
export function parseCallback(url: string, expectedState: string | null): CallbackResult | null {
  const redirect = new URL(REDIRECT_URI);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== redirect.protocol || u.pathname !== redirect.pathname) return null;
  const q = u.searchParams;
  if (!expectedState || q.get("state") !== expectedState) {
    return { ok: false, error: "The sign-in didn't match this app's request. Try again." };
  }
  if (q.get("error")) {
    return {
      ok: false,
      error: q.get("error") === "access_denied" ? "Sign-in was cancelled." : `Sign-in failed (${q.get("error")}).`,
    };
  }
  const code = q.get("code");
  return code ? { ok: true, code } : { ok: false, error: "The server didn't send a sign-in code." };
}

/** Tokens as the app keeps them. */
export type StoredTokens = {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** Unix ms after which the access token is treated as expired. */
  expiresAt: number;
};

/** A /oauth/token response → what the app keeps (expiring a minute early). */
export function toStoredTokens(clientId: string, body: unknown, now = Date.now()): StoredTokens | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.access_token !== "string" || typeof b.refresh_token !== "string") return null;
  const ttl = typeof b.expires_in === "number" ? b.expires_in : 3600;
  return {
    clientId,
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    expiresAt: now + Math.max(0, ttl - 60) * 1000,
  };
}
