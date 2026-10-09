import { and, eq, sql } from "drizzle-orm";
import type { AnswerGrading, ProgressSummary } from "@mdb/shared";
import { db, schema } from "../db/client";
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

  return {
    totalAnswered: totals?.answered ?? 0,
    totalCorrect: totals?.correct ?? 0,
    answeredToday: today?.answered ?? 0,
    dailyGoal: getSettings(userId).dailyGoal,
    perSet: perSet.map((p) => ({
      setId: p.setId,
      answered: p.answered,
      correct: p.correct ?? 0,
    })),
  };
}
