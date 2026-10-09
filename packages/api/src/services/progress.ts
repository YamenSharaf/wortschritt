import { and, eq, sql } from "drizzle-orm";
import type { AnswerGrading, ProgressSummary } from "@mdb/shared";
import { db, schema } from "../db/client";
import { loadExerciseSets } from "../content/loader";
import { latestRunsPerSet, listExerciseProgress } from "./activity";
import { setKind } from "./rules";
import { getSettings } from "./settings";
import { getTimezone, startOfDay } from "./timezone";

/** Store one graded answer (services/answers.ts does the grading). */
export function recordAttempt(
  userId: number,
  a: { setId: string; itemId: string; correct: boolean; response: string; grading: AnswerGrading },
  at?: number,
): void {
  db.insert(schema.attempts)
    .values({
      userId,
      setId: a.setId,
      itemId: a.itemId,
      correct: a.correct,
      response: a.response,
      grading: a.grading,
      ...(at === undefined ? {} : { answeredAt: new Date(at * 1000) }),
    })
    .run();
}

/**
 * Where "Continue practice" goes: the most recently touched of an unfinished
 * practice set (resumed where the learner stopped) and the last finished
 * run's set; a tie goes to the unfinished set.
 */
function continueTarget(userId: number): ProgressSummary["continue"] {
  const titles = new Map(loadExerciseSets().map((s) => [s.id, s.title]));
  const open = listExerciseProgress(userId)
    .filter((p) => titles.has(p.setId) && (p.index > 0 || Object.keys(p.results).length > 0))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const session = open[0];
  const [run] = latestRunsPerSet(userId, 1);
  if (session && (!run || session.updatedAt >= run.finishedAt)) {
    return { setId: session.setId, title: titles.get(session.setId)!, kind: "exercise", resume: true };
  }
  if (!run) return null;
  return {
    setId: run.setId,
    title: run.setTitle,
    kind: setKind(run.setId),
    // Left partway (the run was recorded on leaving): pick up there.
    resume: open.some((p) => p.setId === run.setId),
  };
}

export function getProgressSummary(userId: number): ProgressSummary {
  const mine = eq(schema.attempts.userId, userId);
  const startOfToday = startOfDay(Math.floor(Date.now() / 1000), getTimezone());
  // Ungraded open answers count as practice today, not towards accuracy.
  const graded = and(mine, sql`${schema.attempts.grading} != 'ungraded'`);

  const totals = db
    .select({
      answered: sql<number>`count(*)`,
      correct: sql<number>`sum(case when ${schema.attempts.correct} then 1 else 0 end)`,
    })
    .from(schema.attempts)
    .where(graded)
    .get();

  const today = db
    .select({ answered: sql<number>`count(*)` })
    .from(schema.attempts)
    .where(and(mine, sql`${schema.attempts.answeredAt} >= ${startOfToday}`))
    .get();

  const perSet = db
    .select({
      setId: schema.attempts.setId,
      answered: sql<number>`count(*)`,
      correct: sql<number>`sum(case when ${schema.attempts.correct} then 1 else 0 end)`,
    })
    .from(schema.attempts)
    .where(graded)
    .groupBy(schema.attempts.setId)
    .all();

  const answeredToday = today?.answered ?? 0;
  const dailyGoal = getSettings(userId).dailyGoal;
  const totalAnswered = totals?.answered ?? 0;
  const totalCorrect = totals?.correct ?? 0;
  return {
    totalAnswered,
    totalCorrect,
    answeredToday,
    dailyGoal,
    goalLeft: Math.max(0, dailyGoal - answeredToday),
    goalPercent: dailyGoal > 0 ? Math.min(100, Math.round((answeredToday / dailyGoal) * 100)) : 100,
    accuracy: totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : null,
    continue: continueTarget(userId),
    perSet: perSet.map((p) => ({
      setId: p.setId,
      answered: p.answered,
      correct: p.correct ?? 0,
    })),
  };
}
