/**
 * Central registry of tutor system prompts — one per AI use-case ("task").
 * Every task inherits the shared preamble, so the "explain in English, keep the
 * German in German, be concise, match the learner's level" rule is guaranteed
 * everywhere. Adding a new AI button = add a task here + wire a button.
 */

import { buildStoryPrompt, itemFormatGuide, STORY_LENGTHS, type GenerateStoryBody, type StoryContext } from "@mdb/shared";

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
      " Give exactly ONE short hint that points the learner toward the answer WITHOUT stating it. One sentence, written in English (German words only where the hint quotes them), even though the exercise is in German. Never reveal the answer itself.";
    return {
      system,
      user: `${itemText}\n\n(For your reference only — do NOT reveal this: the answer is "${ctx.item.expected.join('" or "')}".)`,
    };
  }

  // why_wrong
  const system =
    base +
    " The learner just answered this exercise incorrectly. In one or two English sentences, name the specific mistake (case, ending, gender, word order, auxiliary, separable prefix, etc.), then show the corrected German.";
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
    '{"lemma":"<dictionary base form>","pos":"<verb|noun|adjective|adverb|other>","translation":"<short English meaning>","partizip2":"<Partizip II, verbs only>","auxiliary":"<haben|sein, verbs only>","article":"<der|die|das, nouns only>","plural":"<plural, nouns only>","examples":[{"de":"<simple German sentence>","en":"<English translation>"}]}\n' +
    "Set \"lemma\" to the dictionary base form of the given word: the infinitive for a conjugated verb (e.g. \"trifft\" → \"treffen\", \"ging\" → \"gehen\"), and the nominative singular for a noun. Base the translation and examples on that base form. " +
    "For a verb, set \"pos\":\"verb\" and give \"partizip2\" (the Partizip II, e.g. \"getroffen\", \"gegangen\", \"aufgestanden\") and \"auxiliary\" as exactly \"haben\" or \"sein\" (the perfect-tense auxiliary). " +
    "For a noun, set \"pos\":\"noun\" and give \"article\" (der/die/das) and \"plural\". Omit the fields that don't apply to the word's part of speech. " +
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

/** The German for an English word, in the sense its sentence uses (translation exercises). */
export function buildGermanWordMessages(ctx: { word: string; context?: string }): { system: string; user: string } {
  const system =
    "You are a concise English→German dictionary for a German learner. Give the German for the English word or phrase in the sense the sentence uses it. " +
    'Return ONLY a compact JSON object: {"de": string, "lemma": string, "en": string, "pos": "noun"|"verb"|"adjective"|"adverb"|"other", "article": "der"|"die"|"das" (nouns only)}. ' +
    '"de" is how a learner notes it: a noun with its article ("der Bahnhof"), a verb in the infinitive (a separable verb whole, "aufstehen"; a reflexive one with "sich", "sich beeilen"). ' +
    '"lemma" is the German base form without article or "sich". "en" is the English base form ("forgot" → "to forget"). Do not translate the whole sentence.';
  const user = `Word: ${ctx.word}` + (ctx.context ? `\nSentence: "${ctx.context}"` : "");
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
    "The learning content must be in German and grammatically correct, with the correct answer(s) provided. " +
    `Use ONLY these item types: ${ctx.types.join(", ")}. ` +
    'Output ONLY a JSON object of the form {"items":[ ... ]} — no prose, no markdown code fences.\n\n' +
    itemFormatGuide({ withIds: false });
  const user =
    `Set: "${ctx.title}" · level ${ctx.level} · topics: ${ctx.tags.join(", ") || "—"}\n` +
    `Generate ${ctx.count} new items using the types above. Make them distinct from these examples (same style and difficulty, new content):\n` +
    ctx.samples;
  return { system, user };
}

/**
 * Write a graded-reader story from the learner's request, keeping their
 * context in mind. The system prompt is the story authoring guide (the same
 * one the editor's "Copy LLM prompt" and agents use); the user message is the
 * request plus the context the learner chose to include.
 */
export function buildStoryMessages(ctx: {
  request: GenerateStoryBody;
  level: string;
  context: StoryContext;
}): { system: string; user: string } {
  const guide = buildStoryPrompt()
    .split("\n")
    .filter((line) => !/^Topic\b/.test(line))
    .join("\n")
    .trimEnd();
  const system =
    "You write short graded readers in German for language learners: engaging, natural, correct German " +
    "pitched exactly at the requested CEFR level. Never mention that the text is for practice, and never quote exercises.\n\n" +
    guide;

  const { request: r, context: c } = ctx;
  const words = STORY_LENGTHS[r.length];
  const lines = [
    `The learner asks for: ${r.prompt}`,
    "",
    `Level: ${ctx.level}. Length: about ${words} words (body only).`,
    r.questions > 0
      ? `Questions: exactly ${r.questions} comprehension questions about the story, mixing item types (true_false, multiple_choice, and cloze or transform where they fit).`
      : 'Questions: none — "questions": [].',
    r.vocabulary === "stretch"
      ? `Vocabulary: mostly at ${ctx.level}, plus a few new, useful words slightly above it (about 1 in 20); put every new word in the glossary.`
      : `Vocabulary: only words a ${ctx.level} learner knows; the glossary holds just the few that may still be unfamiliar.`,
  ];
  if (c.mistakes.length) {
    lines.push(
      "",
      "The learner recently got these wrong. Use the same grammar and words correctly and naturally in the story, several times where it fits (don't copy the sentences):",
      ...c.mistakes.map(
        (m) => `- ${m.task} → correct: ${m.answer}${m.response ? ` (they wrote: ${m.response})` : ""}`,
      ),
    );
  }
  if (c.words.length) {
    lines.push("", `Words the learner is learning — work in as many as fit naturally: ${c.words.join(", ")}`);
  }
  if (c.topics.length) {
    lines.push("", `Recently practised topics (connect to them if it fits the request): ${c.topics.join("; ")}`);
  }
  return { system, user: lines.join("\n") };
}

/** Follow-up when the story's JSON didn't validate. */
export function buildStoryRepair(problems: string[]): string {
  return `That JSON has these problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nReturn the complete corrected JSON only.`;
}

/** English for story sentences, one line per sentence, same structure back. */
export function buildSentenceTranslation(ctx: { level: string; paragraphs: string[][] }): {
  system: string;
  user: string;
} {
  const system =
    `You translate German sentences from a ${ctx.level} graded reader into natural, accurate English for a learner. ` +
    "Translate each sentence on its own line: keep close to the German so the learner can match the two, but write correct, idiomatic English. Keep names as they are. " +
    'You get {"paragraphs":[["Satz", …], …]}; reply ONLY with {"paragraphs":[["Sentence", …], …]} — exactly the same number of paragraphs and, in each, exactly one English string per German sentence, in order. No prose, no code fences.';
  return { system, user: JSON.stringify({ paragraphs: ctx.paragraphs }) };
}

/** Judge one free-text answer that the item's own rules didn't accept. */
export function buildGradeMessages(ctx: {
  prompt?: string;
  context?: string;
  expected: string[];
  response: string;
  open: boolean;
}): { system: string; user: string } {
  const system =
    "You grade short German-learning answers. Decide if the learner's answer is acceptable German for the task, allowing valid variants (word order, punctuation, equivalent spellings) but requiring correct grammar and meaning. " +
    "The learner is often completing a sentence whose beginning is already shown to them (given as 'Shown to the learner'). When it is, accept an answer that supplies only the missing part if, combined with that beginning, it forms a correct sentence — do NOT require the learner to retype the part they were already given. Only mark such an answer wrong if the completion itself is grammatically wrong or doesn't fit. " +
    "When the reference answers are marked as examples, the task is open-ended: judge whether the learner's answer correctly and sensibly fulfils the task on its own merits — it does not need to resemble the examples. " +
    "Reply with ONLY a compact JSON object: {\"correct\": boolean, \"feedback\": \"one short sentence in English\"}.";
  const user = [
    ctx.prompt ? `Task: ${ctx.prompt}` : null,
    ctx.context ? `Shown to the learner (sentence beginning): ${ctx.context}` : null,
    ctx.open
      ? `Example answers (open-ended — any other correct answer also counts): ${ctx.expected.join(" | ")}`
      : `Reference answer(s) (full sentence): ${ctx.expected.join(" | ")}`,
    `Learner answer: ${ctx.response}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

/**
 * Judge an English → German translation: same meaning, correct German, any
 * natural phrasing. "almost" is one small slip (an article, an ending, a word
 * order detail) in an otherwise right sentence; "corrected" is the learner's
 * own sentence with the fewest changes, so they see exactly what to fix.
 */
export function buildTranslateGradeMessages(ctx: {
  english: string;
  examples: string[];
  response: string;
  level: string;
}): { system: string; user: string } {
  const system =
    `You grade a German learner's (${ctx.level}) translation of an English sentence into German. ` +
    "Judge two things: the German means what the English says, and it is grammatically correct, natural German. " +
    "Accept any valid phrasing: other word orders, synonyms, Perfekt or Präteritum where both fit, du/Sie unless the English decides. The example translations are only examples. " +
    "Punctuation (a missing or extra comma, a missing full stop) and capitalisation (a small first letter, a noun without its capital) never make an answer wrong or almost: say \"correct\" and fix them in \"corrected\". " +
    'Verdict: "correct" if it is right; "almost" if the meaning is right but there is exactly one small slip (one wrong article, case or adjective ending, one misspelled word, one misplaced word); "wrong" otherwise (meaning changed or missing, several errors, or a sentence-structure error such as the verb in the wrong position). ' +
    '"corrected" is the learner\'s own sentence with the fewest changes that make it a correct translation (keep their wording wherever it is acceptable). For "correct" it fixes only punctuation and capitalisation, or is an empty string when there\'s nothing to fix. ' +
    '"feedback" is one short sentence in English naming what was wrong (or confirming it). ' +
    'Reply with ONLY a compact JSON object: {"verdict": "correct" | "almost" | "wrong", "corrected": string, "feedback": string}.';
  const user = [
    `English: ${ctx.english}`,
    `Example translations: ${ctx.examples.join(" | ")}`,
    `Learner's German: ${ctx.response}`,
  ].join("\n");
  return { system, user };
}
