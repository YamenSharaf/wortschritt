import { z } from "zod";
import { cefrLevel, cheatsheet, exerciseSet } from "./exercises";

/** User-configurable settings. Persisted as a single JSON row. */
export const settingsSchema = z.object({
  displayName: z.string().min(1).default("Learner"),
  level: cefrLevel.default("A1"),
  dailyGoal: z.number().int().min(1).max(500).default(20),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  /** Let the AI tutor grade free-text answers (only used when it's configured). */
  llmGrading: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Login: single shared password. */
export const loginBody = z.object({
  password: z.string().min(1),
});

/** Record the result of answering one item. */
export const attemptBody = z.object({
  setId: z.string().min(1),
  itemId: z.string().min(1),
  correct: z.boolean(),
});
export type AttemptBody = z.infer<typeof attemptBody>;

/** Payload for the "paste JSON to import" admin screen. */
export const importBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exercise"), data: exerciseSet }),
  z.object({ kind: z.literal("cheatsheet"), data: cheatsheet }),
]);
export type ImportBody = z.infer<typeof importBody>;

/** Per-item correctness for one run, keyed by item id. */
export const runResults = z.record(z.string(), z.boolean());

/** Record one practice run (a pass through an exercise set). */
export const recordRunBody = z.object({
  setId: z.string().min(1),
  setTitle: z.string().min(1),
  total: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  results: runResults,
});
export type RecordRunBody = z.infer<typeof recordRunBody>;

/** Latest-run summary for a set (no per-item detail). */
export const runSummary = z.object({
  setId: z.string(),
  setTitle: z.string(),
  total: z.number().int(),
  answered: z.number().int(),
  correct: z.number().int(),
  finishedAt: z.number().int(),
});
export type RunSummary = z.infer<typeof runSummary>;

/** A full run including the per-item results (for the question navigator). */
export const exerciseRun = runSummary.extend({ results: runResults });
export type ExerciseRun = z.infer<typeof exerciseRun>;

/** Record that a cheat sheet was viewed. */
export const sheetViewBody = z.object({
  sheetId: z.string().min(1),
  title: z.string().min(1),
});
export type SheetViewBody = z.infer<typeof sheetViewBody>;

export const sheetView = z.object({
  sheetId: z.string(),
  title: z.string(),
  viewedAt: z.number().int(),
});
export type SheetView = z.infer<typeof sheetView>;

/** Aggregated progress returned to the dashboard. */
export const progressSummary = z.object({
  totalAnswered: z.number().int(),
  totalCorrect: z.number().int(),
  answeredToday: z.number().int(),
  dailyGoal: z.number().int(),
  perSet: z.array(
    z.object({
      setId: z.string(),
      answered: z.number().int(),
      correct: z.number().int(),
    }),
  ),
});
export type ProgressSummary = z.infer<typeof progressSummary>;
