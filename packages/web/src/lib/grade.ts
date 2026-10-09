import { gradeItem, tutorGradeInput, withoutTutor, type AnswerVerdict, type ExerciseItem, type ItemResponse } from "@mdb/shared";
import { api } from "./api";

/**
 * Grade an answer in the browser: the item's own rules, then the AI tutor on a
 * free-text miss (when enabled), then the no-tutor rule.
 */
export async function gradeHere(item: ExerciseItem, response: ItemResponse, llmGrading: boolean): Promise<AnswerVerdict> {
  const local = gradeItem(item, response);
  if (local.textMiss && llmGrading) {
    try {
      const v = await api.gradeAnswer({
        ...tutorGradeInput(item),
        expected: local.textMiss.answer.accept,
        response: local.textMiss.text,
        open: local.textMiss.answer.grading === "open",
      });
      return { correct: v.correct, grading: "ai", feedback: v.feedback || undefined };
    } catch {
      /* fall back below */
    }
  }
  return withoutTutor(local);
}
