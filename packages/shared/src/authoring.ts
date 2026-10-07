import type { z } from "zod";
import type { cheatsheet, exerciseItem, exerciseSet, story } from "./exercises";

/**
 * ---------------------------------------------------------------------------
 * AUTHORING GUIDE FOR LLMs
 * ---------------------------------------------------------------------------
 * The single description of the content format given to language models:
 * the Import page's "Copy LLM prompt" and the tutor's "generate more items"
 * both build on it, so they can't drift apart. The examples are real,
 * valid content (checked by tests against the schemas), never placeholder
 * text that a model might copy verbatim.
 */

type ItemInput = z.input<typeof exerciseItem>;

/** One valid example per item type. */
export const EXAMPLE_ITEMS: ItemInput[] = [
  {
    type: "multiple_choice",
    id: "q1",
    prompt: "Ich sehe ___ Hund.",
    choices: ["der", "den", "dem"],
    answerIndex: 1,
    explanation: "„sehen“ verlangt den Akkusativ: der → den.",
  },
  {
    type: "cloze",
    id: "q2",
    instructions: "Setze das Verb in der richtigen Form ein.",
    text: "Ich {{1}} jeden Tag um sieben Uhr {{2}}.",
    blanks: [
      { ref: "1", cue: "aufstehen", answer: { accept: ["stehe"] } },
      { ref: "2", answer: { accept: ["auf"] } },
    ],
  },
  { type: "flashcard", id: "q3", front: "mit + ?", back: "Dativ" },
  {
    type: "sentence_build",
    id: "q4",
    instructions: "Bring die Wörter in die richtige Reihenfolge.",
    tokens: ["Gestern", "bin", "ich", "nach Hause", "gegangen"],
    answer: { accept: ["Gestern bin ich nach Hause gegangen."] },
  },
  {
    type: "transform",
    id: "q5",
    instructions: "Setze den Satz ins Perfekt.",
    source: "Ich lerne Deutsch.",
    answer: { accept: ["Ich habe Deutsch gelernt."] },
  },
  {
    type: "true_false",
    id: "q6",
    statement: "„Sie hat nach Hause gegangen.“ ist korrekt.",
    correct: false,
    correction: "Sie ist nach Hause gegangen.",
    explanation: "„gehen“ bildet das Perfekt mit „sein“.",
  },
  {
    type: "conjugation_table",
    id: "q7",
    rows: ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"],
    columns: [{ header: "müssen", answers: ["muss", "musst", "muss", "müssen", "müsst", "müssen"] }],
  },
];

/** A complete valid exercise set (the envelope around the items). */
export const EXAMPLE_SET: z.input<typeof exerciseSet> = {
  schemaVersion: 1,
  id: "perfekt-mit-haben-und-sein",
  title: "Perfekt mit „haben“ und „sein“",
  subtitle: "Present perfect with 'haben' and 'sein'",
  description: "Übe die Bildung des Perfekts.",
  level: "A2",
  tags: ["grammatik", "perfekt", "verben"],
  items: EXAMPLE_ITEMS,
};

export const EXAMPLE_CHEATSHEET: z.input<typeof cheatsheet> = {
  id: "dativ-praepositionen",
  title: "Präpositionen mit Dativ",
  subtitle: "Prepositions that take the dative",
  category: "grammatik",
  sections: [
    {
      heading: "Die Präpositionen",
      body: "**aus, bei, mit, nach, seit, von, zu** stehen immer mit dem Dativ.\n\n| Präposition | Beispiel |\n| --- | --- |\n| mit | Ich fahre **mit dem** Bus. |\n| zu | Wir gehen **zum** Arzt. |",
    },
  ],
};

export const EXAMPLE_STORY: z.input<typeof story> = {
  schemaVersion: 1,
  id: "ein-sonntag-am-see",
  title: "Ein Sonntag am See",
  subtitle: "A Sunday at the lake",
  level: "A2",
  tags: ["freizeit", "perfekt"],
  body: "Am Sonntag ist Lena früh **aufgestanden**. Die Sonne hat geschienen, und sie wollte nicht zu Hause bleiben.\n\nSie hat ihre Freundin Mia angerufen: „Kommst du mit zum See?“ Mia hat sofort Ja gesagt.\n\nAm See sind die beiden geschwommen und haben Eis gegessen. Am Abend war Lena müde, aber glücklich.",
  glossary: [
    { term: "aufstehen", meaning: "to get up" },
    { term: "der See", meaning: "the lake" },
  ],
  questions: [
    {
      id: "q1",
      type: "true_false",
      statement: "Lena ist am Sonntag zu Hause geblieben.",
      correct: false,
      explanation: "Sie ist mit Mia zum See gefahren.",
    },
    {
      id: "q2",
      type: "multiple_choice",
      prompt: "Was haben Lena und Mia am See gemacht?",
      choices: ["Sie haben Fußball gespielt.", "Sie sind geschwommen und haben Eis gegessen.", "Sie haben ein Buch gelesen."],
      answerIndex: 1,
    },
  ],
};

const ITEM_RULES = `Item types (use only these; keys exactly as in the examples):
- multiple_choice: "answerIndex" is the 0-based position of the correct entry in "choices"; choices must be distinct.
- cloze: "text" contains {{ref}} placeholders; every placeholder needs a blank with the same "ref" and every blank must be used. "cue" (optional) is shown beside the blank, e.g. the infinitive.
- flashcard: "front" is shown first, "back" on flip.
- sentence_build: "tokens" is the word bank (multi-word chunks like "nach Hause" are fine); "answer" is the finished sentence. Without "tokens" it becomes a free-text box, and then you MUST list the words to use in "hint" (e.g. "Wörter: heute · wir · lernen · müssen").
- transform: rewrite "source" as "instructions" asks.
- true_false: "correction" (optional) gives the right version when "correct" is false.
- conjugation_table: each column's "answers" has exactly one entry per row, in row order.

Fields any item may also have (leave a field out rather than filling it with filler text):
- "instructions": the task line shown above the item.
- "context": a scenario the item is based on, shown as a quote above the task.
- "hint": always-visible help, e.g. the words to use.
- "explanation": shown after answering — one short sentence on the rule.

Answers ("answer" of cloze, sentence_build, transform): "accept" lists every correct answer; the first one is shown to the learner as the model answer. Include valid variants (e.g. other correct word orders). Grading already ignores case, umlauts typed as a/o/u, and final punctuation, so don't list those variants. Free answers: for open-ended tasks with many correct answers (transform or sentence_build only), set "grading": "open" in "answer" and list two or three good example answers in "accept" — e.g. {"type":"transform","instructions":"Vervollständige den Satz frei.","source":"Für mich ist es wichtig, …","answer":{"accept":["Für mich ist es wichtig, jeden Tag Deutsch zu lernen."],"grading":"open"}}. Other answers are judged by the learner's AI tutor, or shown next to your examples. Never use "open" for tasks with one right answer.

Language: everything the learner reads (prompts, instructions, hints, explanations, descriptions) is simple German at the set's level; only "subtitle" is a short English gloss. German must be grammatically correct.`;

/**
 * The item-format part of a prompt. `withIds: false` for generation, where the
 * server assigns ids.
 */
export function itemFormatGuide({ withIds }: { withIds: boolean }): string {
  const examples = EXAMPLE_ITEMS.map((item) => {
    const { id: _id, ...rest } = item;
    return JSON.stringify(withIds ? item : rest);
  }).join("\n");
  return (
    `One example per item type:\n${examples}\n\n${ITEM_RULES}` +
    (withIds
      ? `\n\nEvery item needs an "id" that is unique within the set (e.g. "q1", "q2", …).`
      : `\n\nDo NOT include an "id" in items — it is assigned automatically.`)
  );
}

/** "Copy LLM prompt" on the Import page. */
export function buildImportPrompt(kind: "exercise" | "cheatsheet"): string {
  if (kind === "cheatsheet") {
    return `Create a German-learning cheat sheet as JSON. Here is a complete, valid example — follow its structure, not its content:
${JSON.stringify(EXAMPLE_CHEATSHEET, null, 2)}

Rules:
- "id": a short, unique slug (lowercase, hyphens).
- "title" in German; "subtitle" (optional) is a short English gloss of the title.
- "category": a lowercase German word, usually "grammatik" or "wortschatz".
- "sections": each has a "heading" and a Markdown "body" (bold, lists and tables are supported). Explanations and examples are in simple German.
- Output ONLY the JSON, with no explanation and no code fences.

Topic: <describe what the sheet should cover>`;
  }
  return `Create a German-learning exercise set as JSON. Here is a complete, valid example of the set envelope (its "items" are listed below) — follow its structure, not its content:
${JSON.stringify({ ...EXAMPLE_SET, items: ["…items…"] }, null, 2)}

Set fields:
- "id": a short, unique slug (lowercase, hyphens).
- "title" in German; "subtitle" (optional) is a short English gloss; "description" is one German sentence.
- "level": exactly one of A1, A2, B1, B2, C1, C2.
- "tags": lowercase German keywords, e.g. "grammatik", "dativ", "verben".

${itemFormatGuide({ withIds: true })}

Output ONLY the JSON, with no explanation and no code fences.

Topic and level: <describe what to practise, e.g. "Dativ-Präpositionen, A2, 12 items, mixed types">`;
}

/** "Copy LLM prompt" for a story, and the story authoring guide for agents. */
export function buildStoryPrompt(): string {
  return `Write a German reading story as JSON. Here is a complete, valid example — follow its structure, not its content:
${JSON.stringify(EXAMPLE_STORY, null, 2)}

Story fields:
- "id": a short slug (lowercase letters, digits and hyphens), unique among the learner's stories.
- "title" in German; "subtitle" (optional) is a short English gloss.
- "level": exactly one of A1, A2, B1, B2, C1, C2. Vocabulary and grammar must fit it.
- "tags": lowercase German keywords for topic and grammar.
- "body": the story in Markdown. Separate paragraphs with a blank line (\\n\\n in JSON); keep paragraphs short (2–5 sentences). Bold (**…**) only a few words worth noticing. Natural, correct German; dialogue in „…“.
- "glossary": words a learner at this level may not know, as {"term", "meaning"}: the base form ("der See", "aufstehen") with a short English meaning.
- "questions": 3–6 comprehension questions about the story, using the item types below. Answers must follow from the text.

${itemFormatGuide({ withIds: true })}

Output ONLY the JSON, with no explanation and no code fences.

Topic, level and length: <describe the story, e.g. "a trip to the bakery, A2, about 300 words">`;
}
