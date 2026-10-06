import type { TextAnswer } from "./exercises";

/** trim, strip surrounding quotes + trailing .?!, collapse whitespace. */
function tidy(s: string): string {
  return s
    .trim()
    .replace(/^["'»«]+|["'«»]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/, "")
    .trim();
}

/**
 * Lenient fold: case-insensitive and umlaut/ß-insensitive, so a learner typing
 * without a German keyboard ("muessen" is not folded, but "mussen"/"Müssen" are)
 * still matches. The canonical spelling is always shown separately.
 */
function fold(s: string): string {
  return tidy(s)
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss");
}

/**
 * Local, dependency-free grading for a free-text answer. Consulted first
 * everywhere; LLM grading (when enabled) only runs on a local miss.
 */
export function gradeText(input: string, answer: TextAnswer): boolean {
  if (answer.grading === "exact") {
    return answer.accept.some((a) => a.trim() === input.trim());
  }
  const got = fold(input);
  return answer.accept.some((a) => fold(a) === got);
}

/** The canonical answer to show the learner after they submit. */
export function modelAnswer(answer: TextAnswer): string {
  return answer.accept[0] ?? "";
}

/** True when the input already matches the canonical answer exactly (trimmed). */
export function isCanonical(input: string, answer: TextAnswer): boolean {
  return input.trim() === modelAnswer(answer).trim();
}
