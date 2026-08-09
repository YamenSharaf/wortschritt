import { z } from "zod";
import { cefrLevel, cheatsheet, exerciseSet } from "./exercises";

/** Choices offered for "generate N more" (in increments of 5). */
export const generateCounts = [5, 10, 15, 20] as const;
export const MAX_GENERATE_COUNT = 20;

/** User-configurable settings. Persisted as a single JSON row. */
export const settingsSchema = z.object({
  displayName: z.string().min(1).default("Learner"),
  level: cefrLevel.default("A1"),
  dailyGoal: z.number().int().min(1).max(500).default(20),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  /** Let the AI tutor grade free-text answers (only used when it's configured). */
  llmGrading: z.boolean().default(true),
  /** Default batch size for "generate N more" on the exercise-done screen. */
  generateCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_GENERATE_COUNT)
    .default(5),
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

/** One usage example: a German sentence and its English translation. */
export const vocabExample = z.object({
  de: z.string(),
  en: z.string(),
});
export type VocabExample = z.infer<typeof vocabExample>;

/** AI word lookup result (not yet saved). */
export const wordLookup = z.object({
  translation: z.string(),
  examples: z.array(vocabExample),
});
export type WordLookup = z.infer<typeof wordLookup>;

/** Ask the tutor to translate a word (optionally with its sentence). */
export const wordQueryBody = z.object({
  word: z.string().min(1).max(80),
  context: z.string().max(400).optional(),
  /** The learner's own definition — steers examples to that meaning. */
  meaning: z.string().max(200).optional(),
});
export type WordQueryBody = z.infer<typeof wordQueryBody>;

/** A saved vocabulary entry. */
export const vocabEntry = z.object({
  word: z.string(),
  display: z.string(),
  translation: z.string(),
  examples: z.array(vocabExample),
  createdAt: z.number().int(),
  /** Ids of the groups this word belongs to. */
  groups: z.array(z.number().int()).default([]),
});
export type VocabEntry = z.infer<typeof vocabEntry>;

/** A named vocab collection. */
export const vocabGroup = z.object({
  id: z.number().int(),
  name: z.string(),
  count: z.number().int(),
  createdAt: z.number().int(),
});
export type VocabGroup = z.infer<typeof vocabGroup>;

export const createGroupBody = z.object({ name: z.string().min(1).max(60) });
export const groupWordBody = z.object({ word: z.string().min(1).max(80) });

/** Add/update a saved word. */
export const saveVocabBody = z.object({
  word: z.string().min(1).max(80),
  display: z.string().min(1).max(80).optional(),
  translation: z.string().min(1),
  examples: z.array(vocabExample).default([]),
});
export type SaveVocabBody = z.infer<typeof saveVocabBody>;

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
