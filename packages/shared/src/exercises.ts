import { z } from "zod";

/**
 * ---------------------------------------------------------------------------
 * EXERCISE TYPE SYSTEM
 * ---------------------------------------------------------------------------
 * Design goals (so this stays generic and easy to extend):
 *  - Every item shares one ENVELOPE (`itemBase`): id + instructions/hint/
 *    explanation. Adding a type never re-invents those.
 *  - Text-answer types reuse ONE grader spec (`textAnswer`) so grading logic
 *    lives in a single place (see grading.ts) and can improve everywhere at
 *    once (e.g. LLM-assisted grading).
 *  - Types are a discriminated union on `type`. Adding a new interactive type
 *    = add a schema here + a renderer in the web app. Nothing else changes.
 *  - `exerciseSet.schemaVersion` lets future migrations be detected.
 */

export const cefrLevel = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);
export type CefrLevel = z.infer<typeof cefrLevel>;

/** Reusable grading spec for any free-text answer. */
export const textAnswer = z.object({
  /** Accepted answers. First entry is treated as the canonical/model answer. */
  accept: z.array(z.string().min(1)).min(1),
  /**
   * exact           — byte-for-byte.
   * normalized      — trim + collapse spaces + ignore trailing . ? ! (keeps
   *                   German capitalisation, which is meaningful).
   * caseInsensitive — like normalized, but also case-folded (good for
   *                   single-word blanks or reordering pre-supplied tokens).
   */
  grading: z.enum(["exact", "normalized", "caseInsensitive"]).default("normalized"),
});
export type TextAnswer = z.infer<typeof textAnswer>;

/** Fields common to every item. */
const itemBase = {
  id: z.string().min(1),
  instructions: z.string().optional(),
  hint: z.string().optional(),
  explanation: z.string().optional(),
};

/** Pick the correct option. */
export const multipleChoiceItem = z.object({
  ...itemBase,
  type: z.literal("multiple_choice"),
  prompt: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2),
  answerIndex: z.number().int().nonnegative(),
});

/** One gap inside a cloze `text`, addressed by `{{ref}}`. */
export const clozeBlank = z.object({
  ref: z.string().min(1),
  /** Shown beside the blank, e.g. the infinitive to conjugate. */
  cue: z.string().optional(),
  answer: textAnswer,
});
/**
 * Fill one or more blanks. `text` holds `{{ref}}` placeholders. Covers single
 * gaps, separable-verb splits (two blanks), modal conjugation (blank + cue),
 * haben/sein choice, etc.
 */
export const clozeItem = z.object({
  ...itemBase,
  type: z.literal("cloze"),
  text: z.string().min(1),
  blanks: z.array(clozeBlank).min(1),
});

/** Front/back recall card. */
export const flashcardItem = z.object({
  ...itemBase,
  type: z.literal("flashcard"),
  front: z.string().min(1),
  back: z.string().min(1),
});

/**
 * Build a sentence. With `tokens`, the UI offers a click-to-arrange word bank
 * (reordering). Without them, it's a free text box. Either way the result is
 * graded against `answer`.
 */
export const sentenceBuildItem = z.object({
  ...itemBase,
  type: z.literal("sentence_build"),
  tokens: z.array(z.string().min(1)).min(2).optional(),
  answer: textAnswer,
});

/** Rewrite `source` into a target form (e.g. present → Perfekt). */
export const transformItem = z.object({
  ...itemBase,
  type: z.literal("transform"),
  source: z.string().min(1),
  answer: textAnswer,
});

/** Judge a statement, optionally revealing a correction. */
export const trueFalseItem = z.object({
  ...itemBase,
  type: z.literal("true_false"),
  statement: z.string().min(1),
  correct: z.boolean(),
  correction: z.string().optional(),
});

/** One column of a conjugation grid; `answers` aligns to `rows`. */
export const conjugationColumn = z.object({
  header: z.string().min(1),
  answers: z.array(z.string()).min(1),
});
/** Fill a pronoun × verb grid. */
export const conjugationTableItem = z.object({
  ...itemBase,
  type: z.literal("conjugation_table"),
  rows: z.array(z.string().min(1)).min(1),
  columns: z.array(conjugationColumn).min(1),
});

export const exerciseItem = z.discriminatedUnion("type", [
  multipleChoiceItem,
  clozeItem,
  flashcardItem,
  sentenceBuildItem,
  transformItem,
  trueFalseItem,
  conjugationTableItem,
]);
export type ExerciseItem = z.infer<typeof exerciseItem>;

export const EXERCISE_TYPES = [
  "multiple_choice",
  "cloze",
  "flashcard",
  "sentence_build",
  "transform",
  "true_false",
  "conjugation_table",
] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

const placeholderRe = /\{\{\s*([^}]+?)\s*\}\}/g;

/** A named, orderable collection of items — the unit you practice. */
export const exerciseSet = z
  .object({
    schemaVersion: z.literal(1).default(1),
    id: z.string().min(1),
    title: z.string().min(1),
    /** Optional short English gloss of the (German) title. */
    subtitle: z.string().optional(),
    description: z.string().default(""),
    level: cefrLevel,
    tags: z.array(z.string()).default([]),
    /** When this material was added (ISO date). Filled from the file's mtime
     *  or the import time when absent; used to sort "recently added" first. */
    createdAt: z.string().optional(),
    items: z.array(exerciseItem).min(1),
  })
  // Cross-field structural checks that a per-field schema can't express.
  .superRefine((set, ctx) => {
    set.items.forEach((item, i) => {
      if (item.type === "cloze") {
        const refs = new Set(item.blanks.map((b) => b.ref));
        const used = new Set<string>();
        for (const m of item.text.matchAll(placeholderRe)) {
          const r = m[1];
          if (r) used.add(r);
        }
        for (const r of used) {
          if (!refs.has(r)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["items", i, "text"],
              message: `Placeholder {{${r}}} has no matching blank`,
            });
          }
        }
        for (const b of item.blanks) {
          if (!used.has(b.ref)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["items", i, "blanks"],
              message: `Blank "${b.ref}" is not referenced in text`,
            });
          }
        }
      }
      if (item.type === "conjugation_table") {
        item.columns.forEach((c, ci) => {
          if (c.answers.length !== item.rows.length) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["items", i, "columns", ci, "answers"],
              message: `Expected ${item.rows.length} answers (one per row), got ${c.answers.length}`,
            });
          }
        });
      }
    });
  });
export type ExerciseSet = z.infer<typeof exerciseSet>;

/**
 * ---------------------------------------------------------------------------
 * CHEAT SHEETS  (non-interactive reference content)
 * ---------------------------------------------------------------------------
 */
export const cheatsheetSection = z.object({
  heading: z.string().min(1),
  /** Markdown (tables supported). Rendered read-only. */
  body: z.string().min(1),
});

export const cheatsheet = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Optional short English gloss of the (German) title. */
  subtitle: z.string().optional(),
  category: z.string().default("general"),
  /** When this sheet was added (ISO date); see exerciseSet.createdAt. */
  createdAt: z.string().optional(),
  sections: z.array(cheatsheetSection).min(1),
});
export type Cheatsheet = z.infer<typeof cheatsheet>;
