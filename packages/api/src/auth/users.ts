import { eq, sql } from "drizzle-orm";
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
 * Create the admin account on first boot after the users table exists
 * (`ADMIN_USERNAME` / `APP_PASSWORD`). Existing single-user installs upgrade
 * into this account and keep logging in with the same password.
 */
export async function ensureAdminUser(log: FastifyBaseLogger): Promise<void> {
  const { n } = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.users)
    .get()!;
  if (n > 0) return;
  db.insert(schema.users)
    .values({
      username: env.ADMIN_USERNAME,
      passwordHash: await hashPassword(env.APP_PASSWORD),
      role: "admin",
    })
    .run();
  log.info({ username: env.ADMIN_USERNAME }, "created admin user");
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
