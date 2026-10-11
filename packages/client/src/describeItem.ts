import type { ExerciseItem } from "@mdb/shared";

/**
 * Compact, human-readable view of an item for the tutor. Sends the visible task
 * text + the correct answer(s) so the AI can hint or explain accurately. Kept
 * on the client so the server prompt registry stays type-agnostic.
 */
export function describeItem(item: ExerciseItem): {
  type: string;
  label: string;
  expected: string[];
} {
  switch (item.type) {
    case "multiple_choice":
      return {
        type: item.type,
        label: `${item.prompt}\nOptions: ${item.choices.join(" | ")}`,
        expected: [item.choices[item.answerIndex] ?? ""],
      };
    case "cloze": {
      let text = item.text;
      for (const b of item.blanks) {
        text = text.replace(
          new RegExp(`\\{\\{\\s*${b.ref}\\s*\\}\\}`),
          `____${b.cue ? ` (${b.cue})` : ""}`,
        );
      }
      return {
        type: item.type,
        label: `${item.instructions ? item.instructions + "\n" : ""}${text}`,
        expected: item.blanks.map((b) => b.answer.accept[0] ?? ""),
      };
    }
    case "transform":
      return {
        type: item.type,
        label: `${item.instructions ?? "Transform the sentence:"}\n${item.source}`,
        expected: item.answer.accept,
      };
    case "sentence_build":
      return {
        type: item.type,
        label: `${item.instructions ?? "Build a sentence."}${
          item.tokens ? `\nWords: ${item.tokens.join(" | ")}` : ""
        }`,
        expected: item.answer.accept,
      };
    case "true_false":
      return {
        type: item.type,
        label: `Statement: ${item.statement}\n(Is it correct German?)`,
        expected: [
          item.correct ? "Correct" : "Incorrect",
          ...(item.correction ? [item.correction] : []),
        ],
      };
    case "conjugation_table":
      return {
        type: item.type,
        label: `Conjugation table — rows: ${item.rows.join(", ")}; columns: ${item.columns
          .map((c) => c.header)
          .join(", ")}`,
        expected: item.columns.flatMap((c) => c.answers),
      };
    case "flashcard":
      return {
        type: item.type,
        label: `Flashcard — front: ${item.front}`,
        expected: [item.back],
      };
    case "translate":
      return {
        type: item.type,
        label: `Translate into German: ${item.english}${
          item.words?.length ? `\nWords given: ${item.words.map((w) => `${w.en} = ${w.de}`).join(", ")}` : ""
        }`,
        expected: item.answer.accept,
      };
  }
}
