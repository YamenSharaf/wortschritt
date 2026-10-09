import type { FastifyBaseLogger } from "fastify";
import {
  gradeItem,
  responseText,
  storySetId,
  tutorGradeInput,
  withoutTutor,
  type AnswerBody,
  type AnswerVerdict,
  type ExerciseItem,
} from "@mdb/shared";
import { judgeAnswer } from "../assistant/grade";
import { loadExerciseSets } from "../content/loader";
import { finishRun, recordInSession } from "./activity";
import { recordAttempt } from "./progress";
import { getSettings } from "./settings";
import { getStory } from "./stories";

/**
 * Grading lives here: the server finds the item, grades the response by the
 * item's own rules (@mdb/shared gradeItem), asks the learner's AI tutor about
 * a free-text miss when they turned AI grading on, and otherwise applies the
 * no-tutor rule. Then it records the answer and adds it to the set's session.
 */

const STORY = storySetId("");

/** The items a set id stands for, for this learner: a library set or a story's questions. */
export function findSet(userId: number, setId: string): { title: string; items: ExerciseItem[] } | null {
  if (setId.startsWith(STORY)) {
    const view = getStory(userId, setId.slice(STORY.length));
    return view ? { title: view.story.title, items: view.story.questions } : null;
  }
  const set = loadExerciseSets().find((s) => s.id === setId);
  return set ? { title: set.title, items: set.items } : null;
}

export class AnswerError extends Error {}

function lookup(userId: number, a: AnswerBody): ExerciseItem {
  const item = findSet(userId, a.setId)?.items.find((i) => i.id === a.itemId);
  if (!item) throw new AnswerError("No such exercise.");
  if (item.type !== a.response.type) throw new AnswerError(`That answer is for a ${a.response.type} item, not ${item.type}.`);
  return item;
}

function keep(userId: number, a: AnswerBody, item: ExerciseItem, v: AnswerVerdict, at?: number): AnswerVerdict {
  const response = responseText(item, a.response);
  recordAttempt(userId, { setId: a.setId, itemId: a.itemId, correct: v.correct, response, grading: v.grading }, at);
  recordInSession(userId, a.setId, { itemId: a.itemId, correct: v.correct, response, ungraded: v.grading === "ungraded" }, at);
  return v;
}

/** Grade, record and return the verdict (the tutor may judge a free-text miss). */
export async function answer(userId: number, a: AnswerBody, log?: FastifyBaseLogger): Promise<AnswerVerdict> {
  const item = lookup(userId, a);
  const local = gradeItem(item, a.response);
  if (local.textMiss && getSettings(userId).llmGrading) {
    const ai = await judgeAnswer(
      userId,
      {
        ...tutorGradeInput(item),
        expected: local.textMiss.answer.accept,
        response: local.textMiss.text,
        open: local.textMiss.answer.grading === "open",
      },
      log,
    );
    if (ai) return keep(userId, a, item, { correct: ai.correct, grading: "ai", ...(ai.feedback ? { feedback: ai.feedback } : {}) });
  }
  return keep(userId, a, item, withoutTutor(local));
}

/** Grade and record without the tutor: answers given offline at `at`, replayed from the app. */
export function answerOffline(userId: number, a: AnswerBody, at: number): AnswerVerdict {
  const item = lookup(userId, a);
  return keep(userId, a, item, withoutTutor(gradeItem(item, a.response)), at);
}

/** End a pass through a set (see finishRun). False when there's no such set. */
export function finish(userId: number, setId: string, done: boolean): boolean {
  const set = findSet(userId, setId);
  if (!set) return false;
  finishRun(userId, setId, { title: set.title, total: set.items.length }, done);
  return true;
}
