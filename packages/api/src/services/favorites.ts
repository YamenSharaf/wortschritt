import { and, desc, eq } from "drizzle-orm";
import type { Favorite, FavoriteKind } from "@mdb/shared";
import { loadCheatsheets, loadExerciseSets } from "../content/loader";
import { db, schema } from "../db/client";

/**
 * Starred exercise sets and cheat sheets, per learner (Home shows them first).
 * Unstarring keeps the row, off, with its time: a change only applies when
 * it's newer than the last one, so an older offline change from the app
 * can't undo a newer one.
 */

/** This learner's favourites, newest first, leaving out items no longer in the library. */
export function listFavorites(userId: number): Favorite[] {
  const sets = new Set(loadExerciseSets().map((s) => s.id));
  const sheets = new Set(loadCheatsheets().map((s) => s.id));
  return db
    .select()
    .from(schema.favorites)
    .where(and(eq(schema.favorites.userId, userId), eq(schema.favorites.on, true)))
    .orderBy(desc(schema.favorites.at))
    .all()
    .filter((r) => (r.kind === "exercise" ? sets : sheets).has(r.itemId))
    .map((r) => ({ kind: r.kind, id: r.itemId, createdAt: r.at }));
}

/** Whether a library item with this kind and id exists. */
export function favoriteTargetExists(kind: FavoriteKind, id: string): boolean {
  return (kind === "exercise" ? loadExerciseSets() : loadCheatsheets()).some((s) => s.id === id);
}

/** Star or unstar; `at` (seconds) defaults to now. False when a newer change is already there. */
export function setFavorite(userId: number, kind: FavoriteKind, id: string, on: boolean, at = Math.floor(Date.now() / 1000)): boolean {
  const key = and(eq(schema.favorites.userId, userId), eq(schema.favorites.kind, kind), eq(schema.favorites.itemId, id));
  const current = db.select().from(schema.favorites).where(key).get();
  if (current && current.at > at) return false;
  if (current?.on === on) return true;
  db.insert(schema.favorites)
    .values({ userId, kind, itemId: id, on, at })
    .onConflictDoUpdate({ target: [schema.favorites.userId, schema.favorites.kind, schema.favorites.itemId], set: { on, at } })
    .run();
  return true;
}
