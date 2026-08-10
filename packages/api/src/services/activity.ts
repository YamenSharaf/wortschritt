import { desc, eq, sql } from "drizzle-orm";
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

export function recordRun(r: RecordRunBody): void {
  db.insert(schema.exerciseRuns)
    .values({
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
export function latestRunsPerSet(limit?: number): RunSummary[] {
  const rows = db.all(sql`
    SELECT r.set_id AS setId, r.set_title AS setTitle, r.total AS total,
           r.answered AS answered, r.correct AS correct, r.finished_at AS finishedAt
    FROM exercise_runs r
    JOIN (
      SELECT set_id, MAX(id) AS mid FROM exercise_runs GROUP BY set_id
    ) g ON r.id = g.mid
    ORDER BY r.finished_at DESC, r.id DESC
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `) as RunSummary[];
  return rows;
}

/** The latest run for one set, including per-item results. */
export function latestRunForSet(setId: string): ExerciseRun | null {
  const row = db
    .select()
    .from(schema.exerciseRuns)
    .where(eq(schema.exerciseRuns.setId, setId))
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

export function getExerciseProgress(setId: string): ExerciseProgress | null {
  const row = db
    .select()
    .from(schema.exerciseProgress)
    .where(eq(schema.exerciseProgress.setId, setId))
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

export function saveExerciseProgress(
  setId: string,
  body: SaveExerciseProgressBody,
): void {
  const row = {
    setId,
    position: body.index,
    results: body.results,
    responses: body.responses,
  };
  db.insert(schema.exerciseProgress)
    .values(row)
    .onConflictDoUpdate({
      target: schema.exerciseProgress.setId,
      set: {
        position: row.position,
        results: row.results,
        responses: row.responses,
        updatedAt: sql`(unixepoch())`,
      },
    })
    .run();
}

export function clearExerciseProgress(setId: string): void {
  db.delete(schema.exerciseProgress)
    .where(eq(schema.exerciseProgress.setId, setId))
    .run();
}

export function recordSheetView(v: SheetViewBody): void {
  db.insert(schema.sheetViews)
    .values({ sheetId: v.sheetId, title: v.title })
    .onConflictDoUpdate({
      target: schema.sheetViews.sheetId,
      set: { title: v.title, viewedAt: sql`(unixepoch())` },
    })
    .run();
}

export function recentSheetViews(limit = 6): SheetView[] {
  return db
    .select()
    .from(schema.sheetViews)
    .orderBy(desc(schema.sheetViews.viewedAt))
    .limit(limit)
    .all();
}
