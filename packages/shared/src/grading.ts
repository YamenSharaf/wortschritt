import type { TextAnswer } from "./exercises";

/** trim, collapse internal whitespace, drop surrounding quotes + trailing .?! */
function normalize(s: string): string {
  return s
    .trim()
    .replace(/^["'»«]+|["'«»]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/, "")
    .trim();
}

/**
 * Local, dependency-free grading for a free-text answer. This is the first
 * pass everywhere; LLM grading (when enabled) is only consulted on a local
 * miss, so a correct answer never needs a network call.
 */
export function gradeText(input: string, answer: TextAnswer): boolean {
  if (answer.grading === "exact") return answer.accept.includes(input);
  const fold =
    answer.grading === "caseInsensitive"
      ? (x: string) => normalize(x).toLowerCase()
      : (x: string) => normalize(x);
  const got = fold(input);
  return answer.accept.some((a) => fold(a) === got);
}

/** The answer to show the learner after they submit. */
export function modelAnswer(answer: TextAnswer): string {
  return answer.accept[0] ?? "";
}
