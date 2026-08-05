import { z } from "zod";

/**
 * ---------------------------------------------------------------------------
 * EXERCISE TYPE SYSTEM  ("features" — coded once, then filled with content)
 * ---------------------------------------------------------------------------
 * Each exercise *type* is a Zod schema. Content authors (or an LLM) produce
 * JSON that must validate against one of these schemas. The web renderer has
 * one component per type. To add a NEW kind of interactive exercise you add a
 * schema here + a renderer in the web app — that is the only "coding" needed.
 * Everything else is data.
 */

export const cefrLevel = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);
export type CefrLevel = z.infer<typeof cefrLevel>;

const itemBase = z.object({
  id: z.string().min(1),
  /** Optional teaching note shown after the item is answered. */
  explanation: z.string().optional(),
});

/** Pick the correct option. */
export const multipleChoiceItem = itemBase.extend({
  type: z.literal("multiple_choice"),
  prompt: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2),
  /** Zero-based index into `choices`. */
  answerIndex: z.number().int().nonnegative(),
});

/** Type the missing word. `prompt` should contain a `___` placeholder. */
export const fillInBlankItem = itemBase.extend({
  type: z.literal("fill_in_blank"),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  /** Extra accepted spellings/answers (case-insensitive match). */
  acceptable: z.array(z.string()).default([]),
});

/** Front/back flashcard for vocabulary drilling. */
export const flashcardItem = itemBase.extend({
  type: z.literal("flashcard"),
  front: z.string().min(1),
  back: z.string().min(1),
});

/** Reorder the tokens into a grammatical sentence. */
export const sentenceOrderItem = itemBase.extend({
  type: z.literal("sentence_order"),
  tokens: z.array(z.string().min(1)).min(2),
  /** Correct order expressed as indices into `tokens`. */
  order: z.array(z.number().int().nonnegative()).min(2),
});

export const exerciseItem = z.discriminatedUnion("type", [
  multipleChoiceItem,
  fillInBlankItem,
  flashcardItem,
  sentenceOrderItem,
]);
export type ExerciseItem = z.infer<typeof exerciseItem>;

export const EXERCISE_TYPES = [
  "multiple_choice",
  "fill_in_blank",
  "flashcard",
  "sentence_order",
] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

/** A named, orderable collection of items — the unit you practice. */
export const exerciseSet = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  level: cefrLevel,
  tags: z.array(z.string()).default([]),
  items: z.array(exerciseItem).min(1),
});
export type ExerciseSet = z.infer<typeof exerciseSet>;

/**
 * ---------------------------------------------------------------------------
 * CHEAT SHEETS  (non-interactive reference content)
 * ---------------------------------------------------------------------------
 */
export const cheatsheetSection = z.object({
  heading: z.string().min(1),
  /** Markdown. Rendered read-only in the UI. */
  body: z.string().min(1),
});

export const cheatsheet = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().default("general"),
  sections: z.array(cheatsheetSection).min(1),
});
export type Cheatsheet = z.infer<typeof cheatsheet>;
