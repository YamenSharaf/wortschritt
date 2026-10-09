import { and, desc, eq, sql } from "drizzle-orm";
import type {
  ExerciseProgress,
  ExerciseRun,
  RunSummary,
  SaveExerciseProgressBody,
  SheetView,
  SheetViewBody,
} from "@mdb/shared";
import { db, schema } from "../db/client";

type RunRecord = Omit<ExerciseRun, "finishedAt">;

function recordRun(userId: number, r: RunRecord): void {
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
    ungraded: row.ungraded,
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
      ungraded: row.ungraded,
      updatedAt: row.updatedAt,
    }));
}

/** Move the learner's position in a set. `at`: when (unix seconds; default now), for replays from the app. */
export function saveExerciseProgress(
  userId: number,
  setId: string,
  body: SaveExerciseProgressBody,
  at?: number,
): void {
  db.insert(schema.exerciseProgress)
    .values({
      userId,
      setId,
      position: body.index,
      results: {},
      responses: {},
      ...(at === undefined ? {} : { updatedAt: at }),
    })
    .onConflictDoUpdate({
      target: [schema.exerciseProgress.userId, schema.exerciseProgress.setId],
      set: { position: body.index, updatedAt: at ?? sql`(unixepoch())` },
    })
    .run();
}

/** Add a graded answer to the set's session (starting one if needed). */
export function recordInSession(
  userId: number,
  setId: string,
  answer: { itemId: string; correct: boolean; response: string; ungraded: boolean },
  at?: number,
): void {
  const current = getExerciseProgress(userId, setId);
  const results = { ...(current?.results ?? {}), [answer.itemId]: answer.correct };
  const responses = { ...(current?.responses ?? {}), [answer.itemId]: answer.response };
  const ungraded = (current?.ungraded ?? []).filter((id) => id !== answer.itemId);
  if (answer.ungraded) ungraded.push(answer.itemId);
  db.insert(schema.exerciseProgress)
    .values({ userId, setId, position: current?.index ?? 0, results, responses, ungraded, ...(at === undefined ? {} : { updatedAt: at }) })
    .onConflictDoUpdate({
      target: [schema.exerciseProgress.userId, schema.exerciseProgress.setId],
      // A replayed older answer never moves the session's time backwards.
      set: { results, responses, ungraded, recorded: false, updatedAt: at === undefined ? sql`(unixepoch())` : Math.max(at, current?.updatedAt ?? 0) },
    })
    .run();
}

/** Drop items from a set's session (e.g. its generated items were removed). */
export function forgetInSession(userId: number, setId: string, itemIds: string[]): void {
  const current = getExerciseProgress(userId, setId);
  if (!current || itemIds.length === 0) return;
  const gone = new Set(itemIds);
  const keep = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([id]) => !gone.has(id)));
  db.update(schema.exerciseProgress)
    .set({ results: keep(current.results), responses: keep(current.responses), ungraded: current.ungraded.filter((id) => !gone.has(id)) })
    .where(progressKey(userId, setId))
    .run();
}

/**
 * Turn a set's session into a run: the score counts graded answers only
 * (ungraded open answers stay out, like every accuracy figure). Skipped when
 * nothing was answered, or nothing since this session was last recorded.
 * `done` clears the session; otherwise the learner can resume it.
 */
export function finishRun(
  userId: number,
  setId: string,
  set: { title: string; total: number },
  done: boolean,
): boolean {
  const session = getExerciseProgress(userId, setId);
  const recorded = db
    .select({ recorded: schema.exerciseProgress.recorded })
    .from(schema.exerciseProgress)
    .where(progressKey(userId, setId))
    .get()?.recorded;
  if (!session || Object.keys(session.results).length === 0 || recorded) {
    if (done && session) clearExerciseProgress(userId, setId);
    return false;
  }
  const ungraded = new Set(session.ungraded);
  const graded = Object.entries(session.results).filter(([id]) => !ungraded.has(id));
  const run: RunRecord = {
    setId,
    setTitle: set.title,
    total: set.total,
    answered: graded.length,
    correct: graded.filter(([, ok]) => ok).length,
    results: session.results,
  };
  db.transaction(() => {
    recordRun(userId, run);
    if (done) clearExerciseProgress(userId, setId);
    else db.update(schema.exerciseProgress).set({ recorded: true }).where(progressKey(userId, setId)).run();
  });
  return true;
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
