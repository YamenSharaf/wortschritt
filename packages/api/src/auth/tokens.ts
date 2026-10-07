import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { ApiTokenView } from "@mdb/shared";
import { db, schema } from "../db/client";
import type { AuthUser } from "./users";

/**
 * Personal API tokens: `Authorization: Bearer mdb_…`. A token acts as its
 * user (same per-user data and role checks). Only the SHA-256 is stored; the
 * token itself is shown once, at creation.
 */
export const MAX_TOKENS_PER_USER = 10;
const PREFIX = "mdb_";

const now = () => Math.floor(Date.now() / 1000);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function looksLikeApiToken(s: string): boolean {
  return s.startsWith(PREFIX);
}

export function listTokens(userId: number): ApiTokenView[] {
  return db
    .select({
      id: schema.apiTokens.id,
      name: schema.apiTokens.name,
      prefix: schema.apiTokens.prefix,
      createdAt: schema.apiTokens.createdAt,
      lastUsedAt: schema.apiTokens.lastUsedAt,
    })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, userId))
    .orderBy(asc(schema.apiTokens.id))
    .all();
}

/** Returns the new token (shown once), or null when the user has too many. */
export function createToken(userId: number, name: string): string | null {
  const { n } = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, userId))
    .get()!;
  if (n >= MAX_TOKENS_PER_USER) return null;
  const token = PREFIX + randomBytes(32).toString("base64url");
  db.insert(schema.apiTokens)
    .values({ userId, name, tokenHash: hash(token), prefix: token.slice(0, 10) })
    .run();
  return token;
}

export function deleteToken(userId: number, id: number): void {
  db.delete(schema.apiTokens)
    .where(and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.userId, userId)))
    .run();
}

/** The active user behind a token, or null. Records the last use (≤ once a minute). */
export function userFromToken(token: string): AuthUser | null {
  const row = db
    .select({
      tokenId: schema.apiTokens.id,
      lastUsedAt: schema.apiTokens.lastUsedAt,
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      disabled: schema.users.disabled,
    })
    .from(schema.apiTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiTokens.userId))
    .where(eq(schema.apiTokens.tokenHash, hash(token)))
    .get();
  if (!row || row.disabled) return null;
  if (!row.lastUsedAt || now() - row.lastUsedAt > 60) {
    db.update(schema.apiTokens)
      .set({ lastUsedAt: now() })
      .where(eq(schema.apiTokens.id, row.tokenId))
      .run();
  }
  return { id: row.id, username: row.username, role: row.role };
}
