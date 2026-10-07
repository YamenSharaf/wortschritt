import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { ActivityDay, ActivityEvent, ActivityView, ExerciseItem, Mistake, SetHistory } from "@mdb/shared";
import { loadExerciseSets } from "../content/loader";
import { storyQuestionSets, storyTimeline } from "./stories";
import { db, schema } from "../db/client";
import { dateStart, dayKey, getTimezone } from "./timezone";

/**
 * A learner's history, read from the raw logs: `attempts` (every answer, with
 * what was answered since v8), `exercise_runs`, `vocab` / `vocab_reviews`,
 * `notes` and `sheet_views`. Items are looked up in the current content, so
 * a mistake comes with its question and accepted answers.
 */

const toSec = (d: Date | number) => (d instanceof Date ? Math.floor(d.getTime() / 1000) : d);

/** The library's sets plus this learner's story questions ("story:<id>"). */
function setsById(userId: number): Map<string, { title: string; items: ExerciseItem[] }> {
  const sets = new Map<string, { title: string; items: ExerciseItem[] }>(
    loadExerciseSets().map((s) => [s.id, s]),
  );
  for (const [id, s] of storyQuestionSets(userId)) sets.set(id, s);
  return sets;
}

export function getMistakes(
  userId: number,
  opts: { setId?: string; since?: number; includeResolved?: boolean; limit?: number } = {},
): Mistake[] {
  const rows = db
    .select()
    .from(schema.attempts)
    .where(
      and(
        eq(schema.attempts.userId, userId),
        opts.setId ? eq(schema.attempts.setId, opts.setId) : undefined,
      ),
    )
    .orderBy(desc(schema.attempts.id))
    .all()
    // An ungraded open answer is neither right nor wrong.
    .filter((r) => r.grading !== "ungraded");

  // Newest first, so the first row per item is its latest attempt.
  const byItem = new Map<string, { latestCorrect: boolean; wrong: typeof rows }>();
  for (const r of rows) {
    const k = `${r.setId}\u0000${r.itemId}`;
    let entry = byItem.get(k);
    if (!entry) {
      entry = { latestCorrect: r.correct, wrong: [] };
      byItem.set(k, entry);
    }
    if (!r.correct) entry.wrong.push(r);
  }

  const sets = setsById(userId);
  const out: Mistake[] = [];
  for (const { latestCorrect, wrong } of byItem.values()) {
    const last = wrong[0];
    if (!last) continue;
    if (latestCorrect && !opts.includeResolved) continue;
    const lastWrongAt = toSec(last.answeredAt);
    if (opts.since && lastWrongAt < opts.since) continue;
    const set = sets.get(last.setId);
    out.push({
      setId: last.setId,
      setTitle: set?.title ?? null,
      itemId: last.itemId,
      item: set?.items.find((i) => i.id === last.itemId) ?? null,
      wrongCount: wrong.length,
      lastWrongAt,
      responses: [...new Set(wrong.map((w) => w.response).filter((r): r is string => !!r))].slice(0, 3),
      resolved: latestCorrect,
    });
  }
  out.sort((a, b) => b.lastWrongAt - a.lastWrongAt);
  return out.slice(0, opts.limit ?? 50);
}

export const MAX_ACTIVITY_DAYS = 92;

/** Days and events between two dates (inclusive, server time zone). */
export function getActivity(userId: number, opts: { from?: string; to?: string } = {}): ActivityView {
  const tz = getTimezone();
  const now = Math.floor(Date.now() / 1000);
  const to = opts.to ?? dayKey(now, tz);
  const from = opts.from ?? dayKey(dateStart(to, tz, -6), tz);
  const start = dateStart(from, tz);
  const end = Math.min(dateStart(to, tz, 1), dateStart(from, tz, MAX_ACTIVITY_DAYS));

  const days = new Map<string, ActivityDay>();
  const day = (sec: number) => {
    const date = dayKey(sec, tz);
    let d = days.get(date);
    if (!d) {
      d = { date, answered: 0, correct: 0, wordsAdded: 0, wordsReviewed: 0 };
      days.set(date, d);
    }
    return d;
  };
  const events: ActivityEvent[] = [];

  const attempts = db
    .select({ correct: schema.attempts.correct, grading: schema.attempts.grading, at: schema.attempts.answeredAt })
    .from(schema.attempts)
    .where(
      and(
        eq(schema.attempts.userId, userId),
        gte(schema.attempts.answeredAt, new Date(start * 1000)),
        lt(schema.attempts.answeredAt, new Date(end * 1000)),
      ),
    )
    .all();
  for (const a of attempts) {
    const d = day(toSec(a.at));
    d.answered++;
    if (a.correct && a.grading !== "ungraded") d.correct++;
  }

  const inRange = (sec: number) => sec >= start && sec < end;

  for (const r of db.select().from(schema.exerciseRuns).where(eq(schema.exerciseRuns.userId, userId)).all()) {
    if (!inRange(r.finishedAt)) continue;
    events.push({ at: r.finishedAt, kind: "run", ref: r.setId, title: r.setTitle, detail: `${r.correct}/${r.total}` });
  }
  for (const w of db.select().from(schema.vocab).where(eq(schema.vocab.userId, userId)).all()) {
    if (!inRange(w.createdAt)) continue;
    day(w.createdAt).wordsAdded++;
    events.push({ at: w.createdAt, kind: "word_added", ref: w.word, title: w.display });
  }
  const reviews = db
    .select({ at: schema.vocabReviews.reviewedAt })
    .from(schema.vocabReviews)
    .where(
      and(
        eq(schema.vocabReviews.userId, userId),
        gte(schema.vocabReviews.reviewedAt, start),
        lt(schema.vocabReviews.reviewedAt, end),
      ),
    )
    .all();
  for (const r of reviews) day(r.at).wordsReviewed++;
  for (const n of db.select().from(schema.notes).where(eq(schema.notes.userId, userId)).all()) {
    if (inRange(n.createdAt)) events.push({ at: n.createdAt, kind: "note_created", ref: n.id, title: n.title });
    // Only the latest edit is known (notes keep no revisions).
    if (n.updatedAt - n.createdAt > 60 && inRange(n.updatedAt)) {
      events.push({ at: n.updatedAt, kind: "note_edited", ref: n.id, title: n.title });
    }
  }
  for (const st of storyTimeline(userId)) {
    if (inRange(st.createdAt)) events.push({ at: st.createdAt, kind: "story_added", ref: st.id, title: st.title });
    if (st.readAt && inRange(st.readAt)) events.push({ at: st.readAt, kind: "story_read", ref: st.id, title: st.title });
  }
  for (const v of db.select().from(schema.sheetViews).where(eq(schema.sheetViews.userId, userId)).all()) {
    // Only the latest view per sheet is kept.
    if (inRange(v.viewedAt)) events.push({ at: v.viewedAt, kind: "sheet_viewed", ref: v.sheetId, title: v.title });
  }

  events.sort((a, b) => b.at - a.at);
  return {
    timezone: tz,
    days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
    events: events.slice(0, 200),
  };
}

/** Every run of one set (newest first, up to 50) and per-item totals. */
export function getSetHistory(userId: number, setId: string): SetHistory {
  const set = setsById(userId).get(setId);
  const runs = db
    .select()
    .from(schema.exerciseRuns)
    .where(and(eq(schema.exerciseRuns.userId, userId), eq(schema.exerciseRuns.setId, setId)))
    .orderBy(desc(schema.exerciseRuns.id))
    .limit(50)
    .all()
    .map((r) => ({
      id: r.id,
      setId: r.setId,
      setTitle: r.setTitle,
      total: r.total,
      answered: r.answered,
      correct: r.correct,
      finishedAt: r.finishedAt,
      results: r.results,
    }));

  const attempts = db
    .select()
    .from(schema.attempts)
    .where(and(eq(schema.attempts.userId, userId), eq(schema.attempts.setId, setId)))
    .orderBy(desc(schema.attempts.id))
    .all()
    .filter((a) => a.grading !== "ungraded");
  const items = new Map<string, SetHistory["items"][number]>();
  for (const a of attempts) {
    let it = items.get(a.itemId);
    if (!it) {
      it = { itemId: a.itemId, attempts: 0, correct: 0, lastResult: a.correct, lastResponse: a.response ?? null };
      items.set(a.itemId, it);
    }
    it.attempts++;
    if (a.correct) it.correct++;
  }
  // In the set's order; items no longer in the set go last.
  const order = new Map(set?.items.map((i, n) => [i.id, n]) ?? []);
  const sorted = [...items.values()].sort(
    (a, b) => (order.get(a.itemId) ?? 1e9) - (order.get(b.itemId) ?? 1e9),
  );

  return { setId, setTitle: set?.title ?? runs[0]?.setTitle ?? null, runs, items: sorted };
}
