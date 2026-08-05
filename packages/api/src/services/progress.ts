import { sql } from "drizzle-orm";
import type { AttemptBody, ProgressSummary } from "@mdb/shared";
import { db, schema } from "../db/client";
import { getSettings } from "./settings";

export function recordAttempt(a: AttemptBody): void {
  db.insert(schema.attempts)
    .values({ setId: a.setId, itemId: a.itemId, correct: a.correct })
    .run();
}

export function getProgressSummary(): ProgressSummary {
  const startOfToday = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const totals = db
    .select({
      answered: sql<number>`count(*)`,
      correct: sql<number>`sum(case when ${schema.attempts.correct} then 1 else 0 end)`,
    })
    .from(schema.attempts)
    .get();

  const today = db
    .select({ answered: sql<number>`count(*)` })
    .from(schema.attempts)
    .where(sql`${schema.attempts.answeredAt} >= ${startOfToday}`)
    .get();

  const perSet = db
    .select({
      setId: schema.attempts.setId,
      answered: sql<number>`count(*)`,
      correct: sql<number>`sum(case when ${schema.attempts.correct} then 1 else 0 end)`,
    })
    .from(schema.attempts)
    .groupBy(schema.attempts.setId)
    .all();

  return {
    totalAnswered: totals?.answered ?? 0,
    totalCorrect: totals?.correct ?? 0,
    answeredToday: today?.answered ?? 0,
    dailyGoal: getSettings().dailyGoal,
    perSet: perSet.map((p) => ({
      setId: p.setId,
      answered: p.answered,
      correct: p.correct ?? 0,
    })),
  };
}
