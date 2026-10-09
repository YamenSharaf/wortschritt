import { storySetId, type RunSummary } from "@mdb/shared";

/**
 * Small display rules the server decides once for every client (web, app,
 * agents), so none of them re-implements a threshold.
 */

const STORY = storySetId("");

/** A library exercise set, or a story's questions ("story:<id>"). */
export const setKind = (setId: string): RunSummary["kind"] => (setId.startsWith(STORY) ? "story" : "exercise");

/** How a score reads: good ≥ 80%, ok ≥ 50%, weak below; null with nothing graded. */
export function scoreTier(correct: number, answered: number): RunSummary["tier"] {
  if (answered <= 0) return null;
  const share = correct / answered;
  return share >= 0.8 ? "good" : share >= 0.5 ? "ok" : "weak";
}

/** Reading time at a learner's pace, about 120 words a minute; at least one. */
export const readingMinutes = (words: number): number => Math.max(1, Math.round(words / 120));
