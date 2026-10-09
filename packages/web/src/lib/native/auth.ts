/**
 * The app's sign-in: OAuth 2.1 with PKCE in a Custom Tab (the server's own
 * sign-in and consent page), tokens kept in Keystore-backed secure storage.
 *
 * A fresh public client is registered at each sign-in, so a registration the
 * server has pruned never strands the app. Refresh tokens rotate (and refreshing
 * retires the old access token), so concurrent 401s share one refresh.
 */
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { nativeServerUrl, notifyAuthChanged } from "../platform";
import {
  authorizeUrl,
  CLIENT_NAME,
  parseCallback,
  pkcePair,
  randomToken,
  REDIRECT_URI,
  toStoredTokens,
  type StoredTokens,
} from "./oauth";

const TOKENS_KEY = "tokens";
const PENDING_KEY = "pendingSignIn";

/** A sign-in started in the Custom Tab (kept in case Android ends the app meanwhile). */
type Pending = { state: string; verifier: string; clientId: string; origin: string };

let tokens: StoredTokens | null = null;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Unreadable (e.g. the Keystore key was invalidated): treat as signed out.
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  if (value === null) await SecureStorage.removeItem(key);
  else await SecureStorage.setItem(key, JSON.stringify(value));
}

async function setTokens(next: StoredTokens | null): Promise<void> {
  tokens = next;
  await writeJson(TOKENS_KEY, next);
}

export async function loadTokens(): Promise<void> {
  tokens = await readJson<StoredTokens>(TOKENS_KEY);
}

const form = (body: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body).toString(),
  credentials: "omit",
});

// --- tokens for the API client --------------------------------------------------

export async function accessToken(): Promise<string | null> {
  if (tokens && Date.now() >= tokens.expiresAt) await refresh(tokens.accessToken);
  return tokens?.accessToken ?? null;
}

let refreshing: Promise<boolean> | null = null;

/**
 * Get a new access token after `failed` was refused. True when there is a newer
 * one to retry with. Offline, the tokens stay; a refresh token the server no
 * longer accepts signs the app out.
 */
export function refresh(failed: string | null): Promise<boolean> {
  if (tokens && tokens.accessToken !== failed) return Promise.resolve(true);
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(): Promise<boolean> {
  const current = tokens;
  const origin = nativeServerUrl();
  if (!current || !origin) return false;
  let res: Response;
  try {
    res = await fetch(
      `${origin}/oauth/token`,
      form({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: current.clientId }),
    );
  } catch {
    return false;
  }
  if (res.status === 400 || res.status === 401) {
    await setTokens(null);
    notifyAuthChanged();
    return false;
  }
  const next = res.ok ? toStoredTokens(current.clientId, await res.json().catch(() => null)) : null;
  if (!next) return false;
  await setTokens(next);
  return true;
}

/** Forget the tokens and ask the server to revoke them (best effort, so offline works). */
export async function signOut(): Promise<void> {
  const current = tokens;
  const origin = nativeServerUrl();
  await setTokens(null);
  await writeJson(PENDING_KEY, null);
  if (current && origin) {
    void fetch(`${origin}/oauth/revoke`, form({ token: current.refreshToken, client_id: current.clientId })).catch(
      () => {},
    );
  }
}

// --- signing in ---------------------------------------------------------------------

type SignInEvent = { error: string | null };
const signInListeners = new Set<(e: SignInEvent) => void>();

/** Hear how a sign-in ended (an error to show, or null once the tab closed or it worked). */
export function onSignInEnded(listener: (e: SignInEvent) => void): () => void {
  signInListeners.add(listener);
  return () => signInListeners.delete(listener);
}
const ended = (error: string | null) => signInListeners.forEach((l) => l({ error }));

/** Register the app with the server and open its sign-in page in a Custom Tab. */
export async function startSignIn(): Promise<void> {
  const origin = nativeServerUrl();
  if (!origin) throw new Error("Choose a server first.");
  let res: Response;
  try {
    res = await fetch(`${origin}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
      }),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection.");
  }
  if (res.status === 429) throw new Error("Too many sign-in attempts. Try again in a while.");
  const clientId = res.ok ? ((await res.json()) as { client_id?: string }).client_id : undefined;
  if (!clientId) throw new Error(`The server couldn't start the sign-in (${res.status}).`);

  const { verifier, challenge } = await pkcePair();
  const state = randomToken();
  await writeJson(PENDING_KEY, { state, verifier, clientId, origin } satisfies Pending);
  await Browser.open({ url: authorizeUrl(origin, { clientId, challenge, state }) });
}

/** Handle a URL the app was opened with; ignores anything but our OAuth callback. */
export async function handleOpenUrl(url: string): Promise<void> {
  const pending = await readJson<Pending>(PENDING_KEY);
  const result = parseCallback(url, pending?.state ?? null);
  if (!result) return;
  await writeJson(PENDING_KEY, null);
  void Browser.close().catch(() => {});
  if (!result.ok) return ended(result.error);
  if (!pending || pending.origin !== nativeServerUrl()) return ended("The server changed during sign-in. Try again.");

  let body: unknown = null;
  try {
    const res = await fetch(
      `${pending.origin}/oauth/token`,
      form({
        grant_type: "authorization_code",
        code: result.code,
        code_verifier: pending.verifier,
        client_id: pending.clientId,
        redirect_uri: REDIRECT_URI,
      }),
    );
    body = await res.json().catch(() => null);
  } catch {
    return ended("Couldn't reach the server to finish signing in.");
  }
  const next = toStoredTokens(pending.clientId, body);
  if (!next) return ended("The server didn't accept the sign-in. Try again.");
  await setTokens(next);
  notifyAuthChanged();
  ended(null);
}

/** Catch the OAuth redirect, whether the app was running or started by it. */
export function listenForSignIn(): void {
  void App.addListener("appUrlOpen", ({ url }) => void handleOpenUrl(url));
  void App.getLaunchUrl()
    .then((launch) => (launch?.url ? handleOpenUrl(launch.url) : undefined))
    .catch(() => {});
  // Closing the tab without finishing: stop waiting.
  void Browser.addListener("browserFinished", () => ended(null));
}
