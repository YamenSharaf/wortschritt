import { and, eq, ne, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { db, schema } from "../db/client";
import { env } from "../env";
import { hashPassword } from "./password";

export type Role = "admin" | "user";
export interface AuthUser {
  id: number;
  username: string;
  role: Role;
}

/**
 * Create the admin account from `ADMIN_USERNAME` / `APP_PASSWORD` on first
 * boot. Existing single-user installs upgrade into this account and keep
 * logging in with the same password. Migration 3 may have created it already
 * as a placeholder (empty hash, owning the pre-existing data): complete it.
 */
export async function ensureAdminUser(log: FastifyBaseLogger): Promise<void> {
  const { n } = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.users)
    .get()!;
  const placeholder = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.role, "admin"), eq(schema.users.passwordHash, "")))
    .get();
  if (n > 0 && !placeholder) return;

  const values = {
    username: env.ADMIN_USERNAME,
    passwordHash: await hashPassword(env.APP_PASSWORD),
    role: "admin" as const,
  };
  if (placeholder) {
    db.update(schema.users).set(values).where(eq(schema.users.id, placeholder.id)).run();
  } else {
    db.insert(schema.users).values(values).run();
  }
  log.info({ username: env.ADMIN_USERNAME }, "created admin user");
}

export async function createUser(username: string, password: string, role: Role = "user") {
  return db
    .insert(schema.users)
    .values({ username, passwordHash: await hashPassword(password), role })
    .returning({ id: schema.users.id })
    .get();
}

export function listUsers() {
  return db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      disabled: schema.users.disabled,
      createdAt: schema.users.createdAt,
      lastLoginAt: schema.users.lastLoginAt,
    })
    .from(schema.users)
    // Admins first ("admin" < "user"), then by name.
    .orderBy(schema.users.role, schema.users.username)
    .all();
}

export function updateUser(id: number, patch: { disabled?: boolean; role?: Role }): void {
  if (Object.keys(patch).length === 0) return;
  db.update(schema.users).set(patch).where(eq(schema.users.id, id)).run();
}

/** Deletes the account; its learner data goes with it (ON DELETE CASCADE). */
export function deleteUser(id: number): void {
  db.delete(schema.users).where(eq(schema.users.id, id)).run();
}

/** Active admins other than `exceptId` — the last one can't be demoted,
 *  disabled or deleted. */
export function otherActiveAdmins(exceptId: number): number {
  return db
    .select({ n: sql<number>`count(*)` })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.role, "admin"),
        eq(schema.users.disabled, false),
        ne(schema.users.id, exceptId),
      ),
    )
    .get()!.n;
}

export function findUserByUsername(username: string) {
  // `username` is COLLATE NOCASE, so this match is case-insensitive.
  return db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .get();
}

export function findUserById(id: number) {
  return db.select().from(schema.users).where(eq(schema.users.id, id)).get();
}

export async function setPassword(userId: number, password: string): Promise<void> {
  db.update(schema.users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(schema.users.id, userId))
    .run();
}
