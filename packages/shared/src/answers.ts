import { z } from "zod";
import type { ExerciseItem, TextAnswer } from "./exercises";
import { gradeText, isOpenAnswer } from "./grading";

/**
 * What a learner answered to one exercise item, per item type. The server
 * grades these (see gradeItem); the app can grade them the same way offline
 * for a provisional verdict.
 */
export const itemResponse = z.discriminatedUnion("type", [
  z.object({ type: z.literal("multiple_choice"), choice: z.number().int().nonnegative() }),
  /** Each blank's text by its `ref`. */
  z.object({ type: z.literal("cloze"), blanks: z.record(z.string(), z.string().max(500)) }),
  /** Self-graded: did the learner know it? */
  z.object({ type: z.literal("flashcard"), knew: z.boolean() }),
  /** The sentence as built from the tiles, or typed. */
  z.object({ type: z.literal("sentence_build"), text: z.string().max(2000) }),
  z.object({ type: z.literal("transform"), text: z.string().max(2000) }),
  z.object({ type: z.literal("true_false"), value: z.boolean() }),
  /** cells[column][row], aligned to the item's columns and rows. */
  z.object({ type: z.literal("conjugation_table"), cells: z.array(z.array(z.string().max(200))) }),
  /**
   * The German typed. `selfCheck`: the learner's own verdict after comparing
   * with the model answer, sent when nobody else could judge a miss.
   */
  z.object({ type: z.literal("translate"), text: z.string().max(2000), selfCheck: z.boolean().optional() }),
]);
export type ItemResponse = z.infer<typeof itemResponse>;

/** The verdict from the item's own rules (no AI). */
export type LocalGrade = {
  correct: boolean;
  grading: "auto" | "self";
  /**
   * A free-text answer that didn't match: an AI tutor may still accept it.
   * Without one, `withoutTutor` decides (open answers come back ungraded).
   */
  textMiss?: { answer: TextAnswer; text: string };
  /** A translation that didn't match: without a tutor, the learner checks it themselves. */
  selfCheck?: true;
};

/** Grade a response by the item's own rules. Throws if it's for another item type. */
export function gradeItem(item: ExerciseItem, r: ItemResponse): LocalGrade {
  if (r.type !== item.type) throw new Error(`a ${r.type} answer to a ${item.type} item`);
  switch (item.type) {
    case "multiple_choice":
      return { correct: (r as Extract<ItemResponse, { type: "multiple_choice" }>).choice === item.answerIndex, grading: "auto" };
    case "cloze": {
      const blanks = (r as Extract<ItemResponse, { type: "cloze" }>).blanks;
      return { correct: item.blanks.every((b) => gradeText(blanks[b.ref] ?? "", b.answer)), grading: "auto" };
    }
    case "flashcard":
      return { correct: (r as Extract<ItemResponse, { type: "flashcard" }>).knew, grading: "self" };
    case "sentence_build":
    case "transform": {
      const text = (r as { text: string }).text;
      return gradeText(text, item.answer)
        ? { correct: true, grading: "auto" }
        : { correct: false, grading: "auto", textMiss: { answer: item.answer, text } };
    }
    case "true_false":
      return { correct: (r as Extract<ItemResponse, { type: "true_false" }>).value === item.correct, grading: "auto" };
    case "translate": {
      const { text, selfCheck } = r as Extract<ItemResponse, { type: "translate" }>;
      if (selfCheck !== undefined) return { correct: selfCheck, grading: "self" };
      return gradeText(text, item.answer)
        ? { correct: true, grading: "auto" }
        : { correct: false, grading: "auto", textMiss: { answer: item.answer, text }, selfCheck: true };
    }
    case "conjugation_table": {
      const cells = (r as Extract<ItemResponse, { type: "conjugation_table" }>).cells;
      const ok = item.columns.every((col, c) =>
        col.answers.every((expected, row) =>
          gradeText(cells[c]?.[row] ?? "", { accept: [expected], grading: "normalized" }),
        ),
      );
      return { correct: ok, grading: "auto" };
    }
  }
}

/**
 * The final verdict when no AI tutor judged a miss: an open-ended answer
 * can't be called wrong (its `accept` only lists examples), so it's ungraded;
 * anything else stands.
 */
export function withoutTutor(local: LocalGrade): { correct: boolean; grading: "auto" | "self" | "ungraded"; selfCheck?: true } {
  // Not graded yet: the learner compares with the model answer and says (then
  // answers again with `selfCheck`). Nothing is recorded until then.
  if (local.selfCheck) return { correct: false, grading: "ungraded", selfCheck: true };
  if (local.textMiss && isOpenAnswer(local.textMiss.answer)) return { correct: true, grading: "ungraded" };
  return { correct: local.correct, grading: local.grading };
}

/** The response as one line of text, for history and the mistakes list. */
export function responseText(item: ExerciseItem, r: ItemResponse): string {
  switch (r.type) {
    case "multiple_choice":
      return item.type === "multiple_choice" ? (item.choices[r.choice] ?? "") : "";
    case "cloze":
      return item.type === "cloze" ? item.blanks.map((b) => r.blanks[b.ref] ?? "").join(" / ") : "";
    case "flashcard":
      return r.knew ? "Knew it" : "Didn't know";
    case "sentence_build":
    case "transform":
    case "translate":
      return r.text;
    case "true_false":
      return r.value ? "Correct" : "Incorrect";
    case "conjugation_table":
      return item.type === "conjugation_table"
        ? item.rows.map((row, ri) => `${row}: ${item.columns.map((_, c) => r.cells[c]?.[ri] ?? "").join(" / ")}`).join("; ")
        : "";
  }
}

/** What an AI tutor is told about the task when it judges a free-text miss. */
export function tutorGradeInput(item: ExerciseItem): { prompt?: string; context?: string } {
  switch (item.type) {
    case "sentence_build":
      return { prompt: item.instructions ?? "Build a correct German sentence." };
    case "transform": {
      // The stem the learner already sees, so a completion-only answer counts.
      const [given, ...rest] = item.source.split("\n").map((s) => s.trim());
      const lead = rest.filter(Boolean).join(" ");
      return { prompt: item.instructions ?? "Rewrite the sentence as required.", context: [given, lead].filter(Boolean).join(" ") };
    }
    default:
      return {};
  }
}
