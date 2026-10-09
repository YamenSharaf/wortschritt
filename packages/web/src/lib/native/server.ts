/**
 * The server the native app talks to: chosen on first launch, kept in
 * Preferences (it isn't secret; tokens go to secure storage), and loaded
 * before the app renders so `getServer()` can be read synchronously.
 */
import { Preferences } from "@capacitor/preferences";
import { apiVersion, type ApiVersion } from "@mdb/shared";
import { setNativeSession } from "../platform";
import { accessToken, refresh, signOut } from "./auth";
import { normalizeServerUrl, versionProblem } from "./serverUrl";

export type ServerConfig = { origin: string; allowLanHttp: boolean };

const KEY = "server";
let current: ServerConfig | null = null;

export function getServer(): ServerConfig | null {
  return current;
}

/** Point the API client at the server, signing in with ./auth's tokens. */
function use(config: ServerConfig | null): void {
  current = config;
  setNativeSession(config && { serverUrl: config.origin, accessToken, refresh, signOut });
}

export async function loadServer(): Promise<ServerConfig | null> {
  const { value } = await Preferences.get({ key: KEY });
  try {
    const parsed = value ? (JSON.parse(value) as ServerConfig) : null;
    use(parsed && typeof parsed.origin === "string" ? parsed : null);
  } catch {
    use(null);
  }
  return current;
}

export async function saveServer(config: ServerConfig): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(config) });
  use(config);
}

/** Forget the server, signing out of it first (tokens belong to one server). */
export async function clearServer(): Promise<void> {
  await signOut();
  await Preferences.remove({ key: KEY });
  use(null);
}

export type ServerCheck =
  | { ok: true; config: ServerConfig; version: ApiVersion }
  | { ok: false; error: string };

/** Check a typed address: valid, reachable, a Wortschritt server this app supports. */
export async function checkServer(input: string, allowLanHttp: boolean): Promise<ServerCheck> {
  const url = normalizeServerUrl(input, allowLanHttp);
  if (!url.ok) return url;
  let body: unknown;
  try {
    const res = await fetch(`${url.origin}/api/version`, {
      credentials: "omit",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `The server answered with an error (${res.status}).` };
    body = await res.json();
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check the address and your connection." };
  }
  const parsed = apiVersion.safeParse(body);
  if (!parsed.success) return { ok: false, error: "That doesn't look like a Wortschritt server." };
  const problem = versionProblem(parsed.data);
  if (problem) return { ok: false, error: problem };
  return { ok: true, config: { origin: url.origin, allowLanHttp }, version: parsed.data };
}
