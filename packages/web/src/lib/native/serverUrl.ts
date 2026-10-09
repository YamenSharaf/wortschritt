/**
 * Checking the server address the learner types into the app (no I/O here, so
 * it's unit-tested). https is required; plain http only when the learner allows
 * it and the host is on their own network.
 */
import type { ApiVersion } from "@mdb/shared";

/** The app's API client version, compared with the server's `minClient`. */
export const NATIVE_CLIENT_VERSION = 1;

export type ServerUrlCheck = { ok: true; origin: string } | { ok: false; error: string };

/** Private and local addresses: RFC 1918, loopback, link-local, IPv6 ULA, LAN names. */
export function isLanHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (host.includes(":")) return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  return (
    !host.includes(".") ||
    host === "localhost" ||
    /\.(local|lan|home\.arpa|internal)$/.test(host)
  );
}

/** Turn what was typed into a server origin, or say what's wrong with it. */
export function normalizeServerUrl(input: string, allowLanHttp: boolean): ServerUrlCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter your server's address." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That isn't a valid address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "The address must start with https://." };
  }
  if (url.username || url.password) return { ok: false, error: "Leave the user name out of the address." };
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    return { ok: false, error: "Enter only the server's address, without a path." };
  }
  if (url.protocol === "http:") {
    if (!isLanHost(url.hostname)) {
      return { ok: false, error: "Use https://. Plain http only works for a server on your own network." };
    }
    if (!allowLanHttp) {
      return { ok: false, error: "This address uses plain http. Turn on “Allow http on my network” to use it." };
    }
  }
  return { ok: true, origin: url.origin };
}

/** Whether this app can talk to a server with this version; an error to show if not. */
export function versionProblem(v: ApiVersion): string | null {
  if (v.minClient > NATIVE_CLIENT_VERSION) {
    return "This server needs a newer version of the app. Update the app, then try again.";
  }
  return null;
}
