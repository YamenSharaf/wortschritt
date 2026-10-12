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
 * everywhere; LLM grading (when enabled) only runs on a local miss. "open"
 * answers match their examples leniently; a miss there isn't final (see
 * isOpenAnswer).
 */
export function gradeText(input: string, answer: TextAnswer): boolean {
  if (answer.grading === "exact") {
    return answer.accept.some((a) => a.trim() === input.trim());
  }
  const got = fold(input);
  return answer.accept.some((a) => fold(a) === got);
}

/**
 * Like gradeText, but punctuation doesn't count at all (a missing comma before
 * "bitte", a dash, quotes): for translations, where the point is the sentence,
 * not its commas. Words, their order and their spelling still must match.
 */
export function gradeTextIgnoringPunctuation(input: string, answer: TextAnswer): boolean {
  return matchIgnoringPunctuation(input, answer) !== null;
}

const bare = (s: string) => fold(s).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** The accepted answer the input matches apart from case, umlauts typed plain and punctuation; null if none. */
export function matchIgnoringPunctuation(input: string, answer: TextAnswer): string | null {
  const got = bare(input);
  return answer.accept.find((a) => bare(a) === got) ?? null;
}

/** An open-ended task whose `accept` lists examples, not every right answer. */
export function isOpenAnswer(answer: TextAnswer): boolean {
  return answer.grading === "open";
}

/** The canonical answer to show the learner after they submit. */
export function modelAnswer(answer: TextAnswer): string {
  return answer.accept[0] ?? "";
}

/** True when the input already matches the canonical answer exactly (trimmed). */
export function isCanonical(input: string, answer: TextAnswer): boolean {
  return input.trim() === modelAnswer(answer).trim();
}
