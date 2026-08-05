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

/** JSON shapes for every item type — shared by generation and the Import UI. */
const ITEM_SCHEMA_REF = `Item type shapes (use the exact keys):
- multiple_choice: { "type":"multiple_choice","id":"...","prompt":"...","choices":["a","b"],"answerIndex":0,"explanation":"optional" }
- cloze: { "type":"cloze","id":"...","instructions":"optional","text":"Ich {{1}} früh {{2}}.","blanks":[{"ref":"1","cue":"optional hint","answer":{"accept":["stehe"]}},{"ref":"2","answer":{"accept":["auf"]}}] }
- flashcard: { "type":"flashcard","id":"...","front":"...","back":"..." }
- sentence_build: { "type":"sentence_build","id":"...","instructions":"optional","tokens":["Ich","bin","müde"],"answer":{"accept":["Ich bin müde."],"grading":"caseInsensitive"} }
- transform: { "type":"transform","id":"...","instructions":"e.g. Ins Perfekt setzen.","source":"Ich lerne Deutsch.","answer":{"accept":["Ich habe Deutsch gelernt."]} }
- true_false: { "type":"true_false","id":"...","statement":"...","correct":true,"correction":"optional corrected German" }
- conjugation_table: { "type":"conjugation_table","id":"...","rows":["ich","du"],"columns":[{"header":"gehen","answers":["gehe","gehst"]}] }
Rules: cloze {{ref}} placeholders must each have a matching blank; conjugation_table each column's answers must have exactly one entry per row.`;

/** Author new German exercise items in the style of a completed set. */
export function buildGenerateMessages(ctx: {
  title: string;
  level: string;
  tags: string[];
  types: string[];
  samples: string;
  count: number;
}): { system: string; user: string } {
  const system =
    "You are a German-language exercise author. Create NEW practice items matching the given set's topic, level, and item types. " +
    "The learning content must be in German and grammatically correct, with the correct answer(s) provided. Keep any explanations short and in English. " +
    `Use ONLY these item types: ${ctx.types.join(", ")}. ` +
    'Output ONLY a JSON object of the form {"items":[ ... ]} — no prose, no markdown code fences.\n\n' +
    ITEM_SCHEMA_REF;
  const user =
    `Set: "${ctx.title}" · level ${ctx.level} · topics: ${ctx.tags.join(", ") || "—"}\n` +
    `Generate ${ctx.count} new items using the types above. Make them distinct from these examples (same style and difficulty, new content):\n` +
    ctx.samples;
  return { system, user };
}
