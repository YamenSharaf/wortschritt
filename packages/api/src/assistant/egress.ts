import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from "undici";

/**
 * Outbound guard for user-configured AI endpoints.
 *
 * Users can point their tutor at any URL, and the server makes the request —
 * without a guard that's a way to reach the LAN behind the server (SSRF). So:
 * - only `https://`, no credentials in the URL, no redirects;
 * - the destination must be a public address. This is checked on the IP the
 *   socket actually connects to (custom `lookup` on the agent), so a hostname
 *   that resolves privately — or changes after a first check — is refused;
 * - requests time out and responses are size-capped by the callers.
 */

export class EgressError extends Error {}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64 (can map onto private IPv4)
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** Whether an IP literal is a public address we may connect to. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (/^::ffff:/i.test(address)) return false;
    return !blocked.check(address, "ipv6");
  }
  return false;
}

/** Validate an AI base URL; returns it normalized (no trailing slash). */
export function checkAiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new EgressError("not a valid URL");
  }
  if (url.protocol !== "https:") throw new EgressError("the URL must start with https://");
  if (url.username || url.password) {
    throw new EgressError("put the API key in the key field, not in the URL");
  }
  // Node connects to IP literals without a DNS lookup, so check them here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) {
    throw new EgressError("private and local network addresses aren't allowed");
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new EgressError("private and local network addresses aren't allowed");
  }
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/** DNS lookup that refuses non-public results (runs on every new connection). */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || list.length === 0) {
      return callback(
        new EgressError(`${hostname} resolves to a non-public address`),
        "",
        0,
      );
    }
    if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

const agent = new Agent({ connect: { lookup: guardedLookup } });

/** Overridable in tests only (the guard blocks the loopback mock server). */
let transport = (url: string, init: RequestInit): Promise<Response> =>
  undiciFetch(url, { ...init, dispatcher: agent, redirect: "error" });

export function setTransportForTests(fn: typeof transport): void {
  transport = fn;
}

/** fetch() to a user-configured AI endpoint, through the guard. */
export function guardedFetch(url: string, init: RequestInit): Promise<Response> {
  checkAiUrl(url);
  return transport(url, init);
}
