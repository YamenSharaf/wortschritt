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
   * normalized (default) — lenient: trims, collapses spaces, ignores trailing
   *                        . ? ! and surrounding quotes, and folds case and
   *                        umlauts (ä→a, ö→o, ü→u, ß→ss). See grading.ts.
   * caseInsensitive      — currently identical to normalized (kept so
   *                        existing content stays valid).
   * exact                — must match an accepted answer exactly (only
   *                        surrounding whitespace is ignored).
   * open                 — open-ended task: `accept` holds EXAMPLES, not the
   *                        full list. A match is accepted locally; anything
   *                        else goes to the learner's AI tutor; without one,
   *                        the possible answers are shown with no verdict.
   *                        Only for transform and sentence_build.
   */
  grading: z
    .enum(["exact", "normalized", "caseInsensitive", "open"])
    .default("normalized"),
});
export type TextAnswer = z.infer<typeof textAnswer>;

/** Fields common to every item. */
const itemBase = {
  id: z.string().min(1),
  instructions: z.string().optional(),
  /** A scenario/premise the item is based on, shown as a distinct quoted block
   *  above the prompt (e.g. "Die Presse möchte alles über die Hochzeit wissen."). */
  context: z.string().optional(),
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
  answers: z.array(z.string().min(1)).min(1),
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

/**
 * Cross-item checks shared by exercise sets and story questions: unique ids,
 * choices in range, cloze placeholders matching blanks, table shapes. `base`
 * is the path to the items array (for error messages).
 */
export function checkItems(items: ExerciseItem[], ctx: z.RefinementCtx, base: (string | number)[]): void {
  // Progress, resume position and run results are keyed by item id.
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...base, i, "id"],
        message: `Duplicate item id "${item.id}" (ids must be unique within a set)`,
      });
    }
    seen.add(item.id);
  });
  items.forEach((item, i) => {
    if (item.type === "multiple_choice") {
      if (item.answerIndex >= item.choices.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...base, i, "answerIndex"],
          message: `answerIndex ${item.answerIndex} is out of range (${item.choices.length} choices, counted from 0)`,
        });
      }
      if (new Set(item.choices.map((c) => c.trim())).size !== item.choices.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...base, i, "choices"],
          message: "Choices must be distinct",
        });
      }
    }
    if (item.type === "cloze") {
      item.blanks.forEach((b, bi) => {
        if (b.answer.grading === "open") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...base, i, "blanks", bi, "answer", "grading"],
            message: `"open" grading is only for transform and sentence_build items`,
          });
        }
      });
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
            path: [...base, i, "text"],
            message: `Placeholder {{${r}}} has no matching blank`,
          });
        }
      }
      for (const b of item.blanks) {
        if (!used.has(b.ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...base, i, "blanks"],
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
            path: [...base, i, "columns", ci, "answers"],
            message: `Expected ${item.rows.length} answers (one per row), got ${c.answers.length}`,
          });
        }
      });
    }
  });
}

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
    /** When this material was added (ISO date); sorts "recently added" first.
     *  Imports get their import time; undated files sort last. */
    createdAt: z.string().optional(),
    items: z.array(exerciseItem).min(1),
  })
  // Cross-field structural checks that a per-field schema can't express.
  .superRefine((set, ctx) => checkItems(set.items, ctx, ["items"]));
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

/**
 * ---------------------------------------------------------------------------
 * STORIES  (reading texts, private to the learner who added them)
 * ---------------------------------------------------------------------------
 */
export const storyGlossaryEntry = z.object({
  term: z.string().min(1),
  /** Short English meaning (or a simple German paraphrase). */
  meaning: z.string().min(1),
});

export const story = z
  .object({
    schemaVersion: z.literal(1).default(1),
    /** URL slug, unique per learner. */
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be a lowercase slug, e.g. ein-tag-am-see"),
    title: z.string().min(1).max(200),
    /** Optional short English gloss of the (German) title. */
    subtitle: z.string().max(200).optional(),
    level: cefrLevel,
    tags: z.array(z.string()).default([]),
    /** The story, in Markdown. Paragraphs are separated by blank lines. */
    body: z.string().min(1).max(60_000),
    /** Words worth explaining, shown in a drawer next to the text. */
    glossary: z.array(storyGlossaryEntry).default([]),
    /** Comprehension questions, using the exercise item types. */
    questions: z.array(exerciseItem).default([]),
  })
  .superRefine((s, ctx) => checkItems(s.questions, ctx, ["questions"]));
export type Story = z.infer<typeof story>;

/**
 * ---------------------------------------------------------------------------
 * SERIES  (a book: chapters are stories, private like them)
 * ---------------------------------------------------------------------------
 */
export const seriesOutlineEntry = z.object({
  title: z.string().min(1).max(200),
  /** What happens in this chapter (for the writer). */
  plan: z.string().max(2000).default(""),
});

export const series = z.object({
  schemaVersion: z.literal(1).default(1),
  /** URL slug, unique per learner (also the prefix of its chapters' ids). */
  id: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be a lowercase slug, e.g. dino-in-berlin"),
  title: z.string().min(1).max(200),
  /** Optional short English gloss of the (German) title. */
  subtitle: z.string().max(200).optional(),
  /** Level of the first chapter (chapters may rise from there). */
  level: cefrLevel,
  /** Shown to the learner: what the book is about (German, at the level). */
  description: z.string().max(2000).default(""),
  tags: z.array(z.string()).default([]),
  /**
   * The story bible, for whoever writes the chapters (not shown in the
   * reader): characters, setting, tone, style rules, recurring vocabulary.
   * Markdown.
   */
  bible: z.string().max(20_000).default(""),
  /** The plan, one entry per chapter; its length is the book's planned size. */
  outline: z.array(seriesOutlineEntry).max(100).default([]),
});
export type Series = z.infer<typeof series>;

/** A chapter's story id: "<series id>-01". */
export const chapterStoryId = (seriesId: string, chapter: number) =>
  `${seriesId}-${String(chapter).padStart(2, "0")}`;
