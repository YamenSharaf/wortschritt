import type { FastifyRequest } from "fastify";

/**
 * Brute-force protection that complements the per-IP rate limit on the auth
 * routes: after MAX_FAILURES wrong passwords for one username within WINDOW_MS,
 * that username is locked until the window ends — whichever IPs the attempts
 * come from. In memory: a restart clears it, which is fine for a small app.
 */
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED = 10_000;

const failures = new Map<string, { count: number; resetAt: number }>();

const key = (username: string) => username.trim().toLowerCase();

/** Seconds until the username may try again, or 0 if it isn't locked. */
export function lockedFor(username: string): number {
  const entry = failures.get(key(username));
  if (!entry) return 0;
  const left = entry.resetAt - Date.now();
  if (left <= 0) {
    failures.delete(key(username));
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil(left / 1000) : 0;
}

export function recordFailure(username: string): void {
  const k = key(username);
  const t = Date.now();
  const entry = failures.get(k);
  if (entry && entry.resetAt > t) {
    entry.count += 1;
    return;
  }
  if (failures.size >= MAX_TRACKED) {
    for (const [name, e] of failures) if (e.resetAt <= t) failures.delete(name);
  }
  failures.set(k, { count: 1, resetAt: t + WINDOW_MS });
}

export function clearFailures(username: string): void {
  failures.delete(key(username));
}

/**
 * The client's IP for rate limiting. Behind a Cloudflare Tunnel every request
 * arrives from cloudflared, so prefer the CF-Connecting-IP header Cloudflare
 * sets (and overwrites if a client sends its own).
 */
export function clientIp(req: FastifyRequest): string {
  const cf = req.headers["cf-connecting-ip"];
  return typeof cf === "string" && cf ? cf : req.ip;
}
