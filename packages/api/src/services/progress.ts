import { and, eq, sql } from "drizzle-orm";
import type { AttemptBody, ProgressSummary } from "@mdb/shared";
import { db, schema } from "../db/client";
import { getSettings } from "./settings";

export function recordAttempt(userId: number, a: AttemptBody): void {
  db.insert(schema.attempts)
    .values({ userId, setId: a.setId, itemId: a.itemId, correct: a.correct })
    .run();
}

export function getProgressSummary(userId: number): ProgressSummary {
  const mine = eq(schema.attempts.userId, userId);
  const startOfToday = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const totals = db
    .select({
      answered: sql<number>`count(*)`,
      correct: sql<number>`sum(case when ${schema.attempts.correct} then 1 else 0 end)`,
    })
    .from(schema.attempts)
    .where(mine)
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
    .where(mine)
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
