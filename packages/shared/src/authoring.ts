import type { z } from "zod";
import type { cheatsheet, exerciseItem, exerciseSet, series, story } from "./exercises";
import { COVER_MAX_BYTES, COVER_VIEWBOX } from "./cover";

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
  {
    type: "translate",
    id: "q8",
    english: "Yesterday I met my friend at the station.",
    words: [
      { en: "met", de: "treffen" },
      { en: "the station", de: "der Bahnhof" },
    ],
    answer: { accept: ["Gestern habe ich meinen Freund am Bahnhof getroffen.", "Ich habe gestern meinen Freund am Bahnhof getroffen."] },
    explanation: "Im Perfekt steht „haben“ an Position 2, das Partizip am Ende.",
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
- translate: the learner translates "english" (a natural English sentence) into German. It practises building the sentence (word order, cases, verb forms), not vocabulary: list in "words" the content words they might not know: "en" exactly as it appears in the sentence (e.g. "met", "the station", "looking forward to"), so it can be underlined there; "de" the German dictionary form, nouns with the article ("der Bahnhof"), reflexive verbs with "sich". The learner can tap any word for its German; these are the ones with a meaning ready. "answer.accept" holds two or three good translations (other correct ones are judged by the tutor). Keep sentences at the set's level and aimed at its grammar topic.

Fields any item may also have (leave a field out rather than filling it with filler text):
- "instructions": the task line shown above the item.
- "context": a scenario the item is based on, shown as a quote above the task.
- "hint": always-visible help, e.g. the words to use.
- "explanation": shown after answering — one short sentence on the rule.

Answers ("answer" of cloze, sentence_build, transform, translate): "accept" lists every correct answer; the first one is shown to the learner as the model answer. Include valid variants (e.g. other correct word orders). Grading already ignores case, umlauts typed as a/o/u, and final punctuation, so don't list those variants. Free answers: for open-ended tasks with many correct answers (transform or sentence_build only), set "grading": "open" in "answer" and list two or three good example answers in "accept" — e.g. {"type":"transform","instructions":"Vervollständige den Satz frei.","source":"Für mich ist es wichtig, …","answer":{"accept":["Für mich ist es wichtig, jeden Tag Deutsch zu lernen."],"grading":"open"}}. Other answers are judged by the learner's AI tutor, or shown next to your examples. Never use "open" for tasks with one right answer.

Language: everything the learner reads (prompts, instructions, hints, explanations, descriptions) is simple German at the set's level; only "subtitle" is a short English gloss, and a translate item's "english" and the English side of its "words". German must be grammatically correct.`;

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

export const EXAMPLE_SERIES: z.input<typeof series> = {
  schemaVersion: 1,
  id: "lena-in-hamburg",
  title: "Lena in Hamburg",
  subtitle: "Lena in Hamburg",
  level: "A2",
  description: "Lena zieht für ein Praktikum nach Hamburg. Sie findet neue Freunde – und ein altes Geheimnis.",
  tags: ["alltag", "freundschaft"],
  bible:
    "## Figuren\n- **Lena Brandt** (24), aus Freiburg, neugierig, etwas chaotisch; Praktikum bei einem Verlag.\n- **Mia Kowalski** (25), Lenas Nachbarin, Fahrradkurierin, direkt und lustig.\n- **Herr Petersen** (70), Vermieter, kennt jede Geschichte im Haus.\n\n## Ort und Zeit\nHamburg-Altona, Herbst. Lenas Wohnung: 3. Stock, Blick auf den Hafen.\n\n## Stil\nErzählt im Präteritum, Dialoge im Präsens. Kurze Sätze. Ein bisschen Humor.\n\n## Wiederkehrender Wortschatz\nder Hafen, das Praktikum, die Nachbarin, sich verlaufen, umziehen",
  outline: [
    { title: "Der Umzug", plan: "Lena kommt mit zu viel Gepäck an, verläuft sich, trifft Mia im Treppenhaus." },
    { title: "Der erste Arbeitstag", plan: "Chaos im Verlag; Lena findet in einem alten Manuskript einen Brief mit ihrer Adresse." },
    { title: "Herr Petersen erzählt", plan: "Der Vermieter erzählt von der Frau, die 1975 in Lenas Wohnung lebte." },
  ],
};

/**
 * How to write a series (a book in chapters) — for agents, which may split
 * the work across sub-agents. Chapters are stories, so the story format and
 * its item rules apply to each.
 */
export function buildSeriesGuide(): string {
  return `A series is a book for a German learner: an ordered list of chapters, each a full story (same format as a story: Markdown body, glossary, comprehension questions). The series holds what keeps the chapters consistent.

The series object — a complete, valid example:
${JSON.stringify(EXAMPLE_SERIES, null, 2)}

Series fields:
- "id": a short slug (lowercase letters, digits, hyphens; at most 60 characters), unique among the learner's series. Chapter ids are derived from it.
- "title" in German; "subtitle" (optional) a short English gloss; "description": 1–3 German sentences at the level, shown to the learner.
- "level": the level of the first chapter. Later chapters may rise gently (each chapter has its own "level").
- "bible" (Markdown, for writers only, never shown to the learner): characters (name, age, traits, how they speak), setting, narrative tense and style rules, and recurring vocabulary to bring back in later chapters.
- "outline": one entry per planned chapter, {"title", "plan"}. Its length is the book's planned size; it may grow later.

Workflow:
1. Write the bible and outline, then save_series.
2. For each chapter, call get_series first: it returns the bible, the outline, every written chapter's summary, and the end of the latest chapter. Write the chapter from that (it does not need to read earlier chapters in full).
3. save_chapter with the series id, the chapter number (1-based), the story, and a summary: 2–4 German or English sentences of what happens, who appears, and anything later chapters must stay consistent with (names, places, open questions). Summaries are how later chapters stay consistent — keep them precise.
4. Chapters may be written in any order (e.g. in parallel from a detailed outline); check continuity afterwards by reading the summaries and fixing chapters with save_chapter and overwrite: true.
5. Optionally give the book and its chapters cover art with set_cover (get_authoring_guide kind "cover").

Chapter rules: each chapter is readable in one sitting (about 300–700 words at A2–B1), continues the story, reuses the bible's recurring vocabulary naturally, and has its own glossary and 3–5 comprehension questions. The chapter's story "id" is set automatically; its "title" is the chapter title.`;
}

/** How to draw cover art (for agents: get_authoring_guide kind "cover"). */
export function buildCoverGuide(): string {
  return `Cover art for a story, a chapter or a series is one SVG illustration, set with set_cover (kind "story" for a story or a chapter — a chapter's id is "<series id>-01" — or "series" for the book). Without one, the app shows a simple generated cover. The book stands face-out on the learner's bookshelf, so make it look like a real, appealing paperback.

Style: a warm hand-drawn comic illustration, like a newspaper comic strip or a children's book — thick, slightly wobbly black ink outlines (stroke "#1d1a17", width 4–6, round joins and caps), flat colours with a watercolour feel, a limited palette of 4–6 colours that fits the story's mood, and paper grain over everything. One clear scene that makes you curious about the story: the main character(s), a key object, a recognisable place. Give characters personality with simple means: a pose, a big expression, a funny detail. Leave a calm area for the title.
- Series cover: the book's title in large lettering (the main word or two very big), plus the level ("A1") in a small badge. Chapter cover: the chapter's title and "Kapitel N", showing that chapter's key moment; keep the book's palette and characters so the chapters look like one set.

Rules (the app checks them and rejects anything else):
- One <svg xmlns="http://www.w3.org/2000/svg" viewBox="${COVER_VIEWBOX}" width="600" height="900">…</svg> — portrait 2:3.
- Elements: svg, g, defs, path, rect, circle, ellipse, line, polyline, polygon, text, tspan, title, desc, linearGradient, radialGradient, stop, clipPath, mask, pattern, use, symbol, and filters (filter, feTurbulence, feDisplacementMap, feGaussianBlur, feColorMatrix, feComposite, feBlend, feOffset, feFlood, feMerge, feMorphology, feComponentTransfer, feDropShadow, lighting). No <style>, <image>, feImage, <script>, <foreignObject>, links or animation.
- Presentation attributes only (fill, stroke, stroke-width, font-size, filter, opacity, …); href and url() may only point inside the SVG ("#id"). No event attributes.
- Fonts: font-family "serif" or "sans-serif" only (other fonts won't be there when the cover is rendered for an EPUB). Keep text at least 40px from the edges; wrap long titles into several <text> lines yourself.
- Filters displace edges inward: draw filtered backgrounds 30px beyond the canvas (e.g. x="-30" y="-30" width="660") so no blank strips show.
- At most ${COVER_MAX_BYTES / 1000} kB; a rich cover is usually 5–15 kB.

Useful filters (put them in <defs>):
<filter id="ink" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.5" xChannelSelector="R" yChannelSelector="G"/></filter>  — hand-drawn wobble for outlined groups and lettering.
<filter id="wash" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="8" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter>  — soft watercolour edges for sky, water, big colour areas.
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="5" result="g"/><feColorMatrix in="g" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.2  0 0 0 0.16 0"/></filter>  — as the last element: <rect width="600" height="900" filter="url(#grain)"/>.

Example (shortened; a series cover):
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${COVER_VIEWBOX}" width="600" height="900">
<defs><filter id="ink" …/><filter id="wash" …/><filter id="grain" …/>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7e3b5"/><stop offset="1" stop-color="#f1b77e"/></linearGradient></defs>
<rect width="600" height="900" fill="#f4ead5"/>
<rect x="-30" y="-30" width="660" height="630" fill="url(#sky)" filter="url(#wash)"/>
<g filter="url(#ink)" stroke="#1d1a17" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">
  <circle cx="175" cy="745" r="82" fill="none"/><circle cx="430" cy="745" r="82" fill="none"/>
  <path d="M175 745 L270 640 L395 640 L430 745 M270 640 L300 745 L175 745 M300 745 L395 640" fill="none" stroke="#3f8f4a" stroke-width="11"/>
  …
</g>
<g filter="url(#ink)"><text x="300" y="150" text-anchor="middle" font-family="serif" font-size="112" font-weight="bold" fill="#1d1a17">Pablo</text>
<text x="300" y="212" text-anchor="middle" font-family="serif" font-size="38" font-style="italic" fill="#1d1a17">und die Karte von</text></g>
<rect width="600" height="900" filter="url(#grain)"/>
</svg>

set_cover reports every rule a cover breaks; fix them and call it again.`;
}
