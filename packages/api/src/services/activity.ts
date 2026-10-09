import { and, desc, eq, sql } from "drizzle-orm";
import type {
  ExerciseProgress,
  ExerciseRun,
  RecordRunBody,
  RunSummary,
  SaveExerciseProgressBody,
  SheetView,
  SheetViewBody,
} from "@mdb/shared";
import { db, schema } from "../db/client";

export function recordRun(userId: number, r: RecordRunBody): void {
  db.insert(schema.exerciseRuns)
    .values({
      userId,
      setId: r.setId,
      setTitle: r.setTitle,
      total: r.total,
      answered: r.answered,
      correct: r.correct,
      results: r.results,
    })
    .run();
}

/**
 * The most recent run of each set, newest first. Uses a groupwise-max join so
 * only the latest row per set survives.
 */
export function latestRunsPerSet(userId: number, limit?: number): RunSummary[] {
  const rows = db.all(sql`
    SELECT r.set_id AS setId, r.set_title AS setTitle, r.total AS total,
           r.answered AS answered, r.correct AS correct, r.finished_at AS finishedAt
    FROM exercise_runs r
    JOIN (
      SELECT set_id, MAX(id) AS mid FROM exercise_runs
      WHERE user_id = ${userId}
      GROUP BY set_id
    ) g ON r.id = g.mid
    ORDER BY r.finished_at DESC, r.id DESC
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `) as RunSummary[];
  return rows;
}

/** The latest run for one set, including per-item results. */
export function latestRunForSet(userId: number, setId: string): ExerciseRun | null {
  const row = db
    .select()
    .from(schema.exerciseRuns)
    .where(
      and(eq(schema.exerciseRuns.userId, userId), eq(schema.exerciseRuns.setId, setId)),
    )
    .orderBy(desc(schema.exerciseRuns.id))
    .limit(1)
    .get();
  if (!row) return null;
  return {
    setId: row.setId,
    setTitle: row.setTitle,
    total: row.total,
    answered: row.answered,
    correct: row.correct,
    finishedAt: row.finishedAt,
    results: row.results,
  };
}

// --- resumable exercise position ------------------------------------------

const progressKey = (userId: number, setId: string) =>
  and(eq(schema.exerciseProgress.userId, userId), eq(schema.exerciseProgress.setId, setId));

export function getExerciseProgress(userId: number, setId: string): ExerciseProgress | null {
  const row = db
    .select()
    .from(schema.exerciseProgress)
    .where(progressKey(userId, setId))
    .get();
  if (!row) return null;
  return {
    setId: row.setId,
    index: row.position,
    results: row.results,
    responses: row.responses,
    updatedAt: row.updatedAt,
  };
}

export function listExerciseProgress(userId: number): ExerciseProgress[] {
  return db
    .select()
    .from(schema.exerciseProgress)
    .where(eq(schema.exerciseProgress.userId, userId))
    .all()
    .map((row) => ({
      setId: row.setId,
      index: row.position,
      results: row.results,
      responses: row.responses,
      updatedAt: row.updatedAt,
    }));
}

/** `at`: when it happened (unix seconds; default now), for replays from the app. */
export function saveExerciseProgress(
  userId: number,
  setId: string,
  body: SaveExerciseProgressBody,
  at?: number,
): void {
  const row = {
    userId,
    setId,
    position: body.index,
    results: body.results,
    responses: body.responses,
    ...(at === undefined ? {} : { updatedAt: at }),
  };
  db.insert(schema.exerciseProgress)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.exerciseProgress.userId, schema.exerciseProgress.setId],
      set: {
        position: row.position,
        results: row.results,
        responses: row.responses,
        updatedAt: at ?? sql`(unixepoch())`,
      },
    })
    .run();
}

export function clearExerciseProgress(userId: number, setId: string): void {
  db.delete(schema.exerciseProgress).where(progressKey(userId, setId)).run();
}

export function recordSheetView(userId: number, v: SheetViewBody): void {
  db.insert(schema.sheetViews)
    .values({ userId, sheetId: v.sheetId, title: v.title })
    .onConflictDoUpdate({
      target: [schema.sheetViews.userId, schema.sheetViews.sheetId],
      set: { title: v.title, viewedAt: sql`(unixepoch())` },
    })
    .run();
}

export function recentSheetViews(userId: number, limit = 6): SheetView[] {
  return db
    .select({
      sheetId: schema.sheetViews.sheetId,
      title: schema.sheetViews.title,
      viewedAt: schema.sheetViews.viewedAt,
    })
    .from(schema.sheetViews)
    .where(eq(schema.sheetViews.userId, userId))
    .orderBy(desc(schema.sheetViews.viewedAt))
    .limit(limit)
    .all();
}
