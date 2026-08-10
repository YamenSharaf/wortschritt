/**
 * Central registry of tutor system prompts — one per AI use-case ("task").
 * Every task inherits the shared preamble, so the "explain in English, keep the
 * German in German, be concise, match the learner's level" rule is guaranteed
 * everywhere. Adding a new AI button = add a task here + wire a button.
 */

export type TutorTask =
  | "highlight"
  | "hint"
  | "why_wrong"
  | "translate_exercise"
  | "translate_sheet";

export type ItemView = { type: string; label: string; expected: string[] };

export type TutorContext = {
  level: string;
  /** Compact, human-readable view of the current exercise item. */
  item?: ItemView;
  /** What the learner typed (for why_wrong). */
  response?: string;
  /** Highlight-to-explain inputs. */
  selection?: string;
  question?: string;
  context?: string;
  /** Raw content to translate (translate_sheet). */
  text?: string;
};

const preamble = (level: string) =>
  `You are a friendly, concise German tutor for one learner at CEFR level ${level}. ` +
  `Write all explanations in English, but keep German words, examples, and corrections in German — never translate the German away. ` +
  `Be brief and concrete: a short example beats a long rule. ` +
  `You may use light Markdown — **bold**, \`inline code\`, and short bullet lists — which the app renders. Keep it compact; avoid large headings.`;

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

  // Translating a reference sheet: keep the German being taught, translate the prose.
  if (task === "translate_sheet") {
    if (!ctx.text) return null;
    const system =
      `You are translating a German-learning reference sheet for a learner at CEFR level ${ctx.level}. ` +
      "Translate the explanatory prose into clear English, but KEEP all German example words, verb forms, articles, endings, and table cells in German — do not translate the German that is being taught. " +
      "Preserve the Markdown structure exactly (tables, lists, bold, block quotes). Output only the translated Markdown, nothing else.";
    return { system, user: ctx.text };
  }

  if (!ctx.item) return null;

  // Translating an exercise: explain the task in English without solving it.
  if (task === "translate_exercise") {
    const system =
      `You are a translator for a German learner at CEFR level ${ctx.level}. ` +
      "Translate this exercise into natural English so the learner understands what to do. " +
      "Do NOT solve it, fill in any blank, choose an option, or reveal the answer — leave blanks as blanks (____). " +
      "You may use light Markdown. Output only the translation.";
    return { system, user: `Exercise (${ctx.item.type}):\n${ctx.item.label}` };
  }

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

/** System prompt for the back-and-forth chat about a wrong answer. */
export function buildChatSystem(ctx: {
  level: string;
  item?: ItemView;
  response?: string;
}): string {
  const it = ctx.item;
  return (
    preamble(ctx.level) +
    " You are helping the learner understand one specific exercise they got wrong, in a back-and-forth chat. Answer their follow-up questions clearly and briefly, staying on this exercise." +
    (it
      ? `\n\nExercise (${it.type}):\n${it.label}\nExpected answer(s): ${it.expected.join(" | ")}`
      : "") +
    (ctx.response ? `\nThe learner's answer was: ${ctx.response}` : "")
  );
}

/** Dictionary lookup for one German word → translation + example sentences. */
export function buildWordMessages(ctx: {
  word: string;
  context?: string;
  meaning?: string;
  count: number;
}): { system: string; user: string } {
  const system =
    "You are a concise German→English dictionary for a learner. " +
    "Return ONLY a compact JSON object, no prose and no markdown fences, shaped exactly:\n" +
    '{"lemma":"<dictionary base form>","translation":"<short English meaning>","examples":[{"de":"<simple German sentence>","en":"<English translation>"}]}\n' +
    "Set \"lemma\" to the dictionary base form of the given word: the infinitive for a conjugated verb (e.g. \"trifft\" → \"treffen\", \"ging\" → \"gehen\"), and the nominative singular for a noun. Base the translation and examples on that base form. " +
    "For nouns, include the article and, if useful, the plural in the translation (e.g. \"das Haus, -äuser — house\"). " +
    "For verbs, give the infinitive meaning. Keep the translation to a few words. " +
    (ctx.meaning
      ? `The learner defines this word as: "${ctx.meaning}". Use that meaning for the translation and examples. `
      : "") +
    `Provide exactly ${ctx.count} natural example sentence(s) at A2–B1 level that use the word (or a natural inflected form). ` +
    "The examples must be different from any sentence given as context.";
  const user =
    `Word: ${ctx.word}` +
    (ctx.context ? `\nIt appeared in: "${ctx.context}"` : "");
  return { system, user };
}

/** Tidy up rough, hand-typed learning notes into clean Markdown. */
export function buildNotesCleanup(ctx: {
  level: string;
  text: string;
}): { system: string; user: string } {
  const system =
    `You are helping a German learner at CEFR level ${ctx.level} tidy up rough notes they typed during a study session. ` +
    "Rewrite them into clean, well-structured Markdown: fix obvious typos and formatting, group related points under short headings, and use bullet lists and tables where they make the notes clearer. " +
    "KEEP all German words, examples, endings, articles, and conjugations exactly as written — never translate the German away or change what is being taught. Do not invent new facts or add content the notes don't contain; only clarify and organise what's there. " +
    "Output ONLY the cleaned-up Markdown, with no preamble, commentary, or code fences.";
  return { system, user: ctx.text };
}

/** JSON shapes for every item type — shared by generation and the Import UI. */
const ITEM_SCHEMA_REF = `Item type shapes (use the exact keys). Do NOT include an "id" — it is assigned automatically:
- multiple_choice: { "type":"multiple_choice","prompt":"...","choices":["a","b"],"answerIndex":0,"explanation":"optional" }
- cloze: { "type":"cloze","instructions":"optional","text":"Ich {{1}} früh {{2}}.","blanks":[{"ref":"1","cue":"optional hint","answer":{"accept":["stehe"]}},{"ref":"2","answer":{"accept":["auf"]}}] }
- flashcard: { "type":"flashcard","front":"...","back":"..." }
- sentence_build: { "type":"sentence_build","instructions":"optional","tokens":["Ich","bin","müde"],"answer":{"accept":["Ich bin müde."],"grading":"caseInsensitive"} } — if you omit "tokens", you MUST put the words to use in "hint" (e.g. "Wörter: heute · wir · lernen · müssen"), since it is shown to the learner.
- transform: { "type":"transform","instructions":"e.g. Ins Perfekt setzen.","source":"Ich lerne Deutsch.","answer":{"accept":["Ich habe Deutsch gelernt."]} }
- true_false: { "type":"true_false","statement":"...","correct":true,"correction":"optional corrected German" }
- conjugation_table: { "type":"conjugation_table","rows":["ich","du"],"columns":[{"header":"gehen","answers":["gehe","gehst"]}] }
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
