/**
 * Central registry of tutor system prompts — one per AI use-case ("task").
 * Every task inherits the shared preamble, so the "explain in English, keep the
 * German in German, be concise, match the learner's level" rule is guaranteed
 * everywhere. Adding a new AI button = add a task here + wire a button.
 */

export type TutorTask = "highlight" | "hint" | "why_wrong";

export type TutorContext = {
  level: string;
  /** Compact, human-readable view of the current exercise item. */
  item?: { type: string; label: string; expected: string[] };
  /** What the learner typed (for why_wrong). */
  response?: string;
  /** Highlight-to-explain inputs. */
  selection?: string;
  question?: string;
  context?: string;
};

const preamble = (level: string) =>
  `You are a friendly, concise German tutor for one learner at CEFR level ${level}. ` +
  `Write all explanations in English, but keep German words, examples, and corrections in German — never translate the German away. ` +
  `Be brief and concrete: a short example beats a long rule. Do not use headings or long lists.`;

/** Build the {system, user} messages for a task, or null if inputs are missing. */
export function buildMessages(
  task: TutorTask,
  ctx: TutorContext,
): { system: string; user: string } | null {
  const base = preamble(ctx.level);

  if (task === "highlight") {
    if (!ctx.selection) return null;
    const system =
      base +
      " The learner highlighted some text in the app and wants help. Explain what is most relevant: meaning, grammar (case, gender, verb form, word order), or a natural translation.";
    const parts = [`Highlighted text:\n"""${ctx.selection}"""`];
    if (ctx.context) parts.push(`Surrounding context:\n"""${ctx.context}"""`);
    parts.push(ctx.question ? `Question: ${ctx.question}` : "Explain this.");
    return { system, user: parts.join("\n\n") };
  }

  if (!ctx.item) return null;
  const itemText = `Exercise (${ctx.item.type}):\n${ctx.item.label}`;

  if (task === "hint") {
    const system =
      base +
      " Give exactly ONE short hint that points the learner toward the answer WITHOUT stating it. One sentence. Never reveal the answer itself.";
    return {
      system,
      user: `${itemText}\n\n(For your reference only — do NOT reveal this: the answer is "${ctx.item.expected.join('" or "')}".)`,
    };
  }

  // why_wrong
  const system =
    base +
    " The learner just answered this exercise incorrectly. In one or two sentences, name the specific mistake (case, ending, gender, word order, auxiliary, separable prefix, etc.), then show the corrected German.";
  return {
    system,
    user: `${itemText}\nExpected answer(s): ${ctx.item.expected.join(" | ")}\nThe learner wrote: ${ctx.response ?? "(nothing)"}`,
  };
}
