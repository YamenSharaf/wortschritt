# Authoring content (exercises & cheat sheets)

Content is **data**, validated against Zod schemas at load time. You never touch
code to add content — you write JSON that matches a schema. This guide is the
reference for generating that JSON (by hand or with an LLM).

The schemas are the source of truth: `packages/shared/src/exercises.ts`.

## Where content lives

- **Git-versioned files** (recommended): `content/exercises/*.json` and
  `content/cheatsheets/*.json`. One set/sheet per file. Ships in the Docker image.
- **Runtime import**: the in-app **Import** screen accepts pasted JSON, validates
  it, and stores it in SQLite (survives image updates). Same schemas.

Both sources are merged by `id` at request time. Imports are a shared library:
only whoever imported an item (or an admin) can replace it, and only an admin
may reuse the `id` of a built-in file (the import then wins).

**Generating with an LLM:** the Import page's **Copy LLM prompt** gives you a
complete prompt (format, one valid example per item type, the rules below and
the house style). It's built from `packages/shared/src/authoring.ts` — the same
guide the tutor's "generate more items" uses.

## Exercise set

```jsonc
{
  "schemaVersion": 1,
  "id": "dativ-basics",            // unique slug
  "title": "Dativ — Grundlagen",   // German
  "subtitle": "Dative — the basics", // optional English gloss (shown under title)
  "description": "Kurze Beschreibung.", // optional German blurb
  "level": "A2",                   // A1 | A2 | B1 | B2 | C1 | C2
  "tags": ["grammatik", "dativ"],
  "items": [ /* one or more items, see below */ ]
}
```

### Fields common to every item

- `id` (required, **unique within the set** — enforced; progress is tracked per item id)
- `instructions` (optional) — task line shown above the item
- `context` (optional) — a scenario/premise the item is based on, shown as a
  distinct quoted block above the prompt (e.g. "Die Presse möchte alles über
  die Hochzeit wissen."). It is also passed to the AI grader.
- `hint` (optional) — **always-visible** helper text (e.g. the words to use)
- `explanation` (optional) — shown after answering

### Text-answer grading (`answer` of cloze blanks, sentence_build, transform)

```jsonc
"answer": { "accept": ["muss"], "grading": "normalized" }
```

- `accept`: array of acceptable answers. **`accept[0]` is the canonical answer**
  shown to the learner.
- `grading`:
  - `normalized` (default) & `caseInsensitive` — both are **lenient**: they fold
    case and umlauts (ä→a, ö→o, ü→u, ß→ss) and ignore trailing punctuation. So
    "Muss"/"mussen" match "muss"/"müssen". The canonical spelling is shown anyway.
  - `exact` — must match exactly (only surrounding whitespace is ignored).
- When the learner's input isn't the exact canonical form (a miss, or a lenient
  accept), the app reveals `accept[0]` so they see the correct spelling.
- **AI grading** (`transform` and `sentence_build` only — cloze blanks are
  always graded by their `accept` list): the server grades every answer; on a
  miss, if the learner has an AI tutor set up
  and the `llmGrading` setting on (the default), the tutor judges the answer,
  using `accept` as reference answers.
- **`open`** — for open-ended tasks with many correct answers (free
  completion): `accept` holds a few **examples**, not the full list, and the
  item shows an "Open answer" badge. A match with an example is accepted
  locally; anything else is judged by the learner's AI tutor, or — if they have
  none (or it fails) — shown next to the possible answers, without a verdict.
  Only valid on `transform` and `sentence_build`. See
  `content/exercises/infinitiv-zu-frei.json`:
  ```jsonc
  { "type": "transform", "id": "iz-a01",
    "instructions": "Vervollständige den Satz frei mit einem Infinitivsatz.",
    "source": "Für mich ist es wichtig, …",
    "answer": { "accept": ["Für mich ist es wichtig, jeden Tag Deutsch zu lernen.",
                           "Für mich ist es wichtig, meine Familie oft zu sehen."],
                "grading": "open" } }
  ```

## Item types

### `multiple_choice`
```jsonc
{ "type": "multiple_choice", "id": "q1", "prompt": "Ich sehe ___ Hund.",
  "choices": ["der", "den", "dem"], "answerIndex": 1, "explanation": "…" }
```
- `answerIndex` is 0-based and must point at one of the `choices`; choices must
  be distinct (both enforced).

### `cloze` — fill one or more blanks
```jsonc
{ "type": "cloze", "id": "q2", "text": "Ich {{1}} früh {{2}}.",
  "blanks": [
    { "ref": "1", "cue": "aufstehen", "answer": { "accept": ["stehe"] } },
    { "ref": "2", "answer": { "accept": ["auf"] } }
  ] }
```
- `text` holds `{{ref}}` placeholders; **every placeholder must have a matching
  blank and vice versa** (enforced).
- `cue` (optional) is shown beside the blank as a hint (e.g. the infinitive).

### `flashcard`
```jsonc
{ "type": "flashcard", "id": "q3", "front": "mit (+ ?)", "back": "Dativ" }
```

### `sentence_build` — arrange or write a sentence
```jsonc
{ "type": "sentence_build", "id": "q4",
  "tokens": ["Ich", "bin", "müde"],           // optional word bank
  "answer": { "accept": ["Ich bin müde."], "grading": "caseInsensitive" } }
```
- With `tokens`, the UI shows a click-to-arrange bank; use `caseInsensitive` so
  the bank's capitalisation doesn't matter.
- **Without `tokens`, you MUST provide `hint`** listing the words to use, e.g.
  `"hint": "Wörter: heute · wir · lernen · müssen"` — otherwise the learner has
  no words to work from.

### `transform` — rewrite a sentence
```jsonc
{ "type": "transform", "id": "q5", "instructions": "Ins Perfekt setzen.",
  "source": "Ich lerne Deutsch.",
  "answer": { "accept": ["Ich habe Deutsch gelernt."] } }
```

### `true_false`
```jsonc
{ "type": "true_false", "id": "q6", "statement": "Sie hat gegangen nach Hause.",
  "correct": false, "correction": "Sie ist nach Hause gegangen." }
```

### `conjugation_table`
```jsonc
{ "type": "conjugation_table", "id": "q7",
  "rows": ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"],
  "columns": [ { "header": "gehen", "answers": ["gehe","gehst","geht","gehen","geht","gehen"] } ] }
```
- Each column's `answers` must have **exactly one non-empty entry per row** (enforced).

## Cheat sheets

```jsonc
{
  "id": "perfekt-mit-sein",
  "title": "Perfekt mit „sein“",
  "subtitle": "Perfect tense with 'sein'",   // optional English gloss
  "category": "grammatik",
  "sections": [
    { "heading": "…", "body": "Markdown here — **bold**, lists, and | tables |." }
  ]
}
```
- `body` is **Markdown** (GitHub-flavored tables supported), rendered read-only.
- Learners can translate a section on demand (keeps the German being taught).

## Stories

Private reading texts: each learner has their own (Stories page, or an agent
via the MCP tool `save_story`). Not files in `content/` — they live in the
`stories` table, validated against `story` in `packages/shared/src/exercises.ts`.

```jsonc
{
  "id": "ein-sonntag-am-see",            // lowercase slug, unique per learner
  "title": "Ein Sonntag am See",
  "subtitle": "A Sunday at the lake",   // optional English gloss
  "level": "A2",
  "tags": ["freizeit", "perfekt"],
  "body": "Am Sonntag ist Lena früh **aufgestanden**. …\n\nSie hat …",
  "glossary": [{ "term": "der See", "meaning": "the lake" }],
  "questions": [ /* exercise items, any type — see above */ ]
}
```
- `body` is Markdown. **Blank lines separate paragraphs**, which are also the
  units of read-aloud; keep them short.
- `glossary`: base forms ("der See", "aufstehen") with a short English meaning.
- `questions`: comprehension questions as exercise items (same rules: unique
  ids, valid `answerIndex`, …). Answers are recorded in history under the set
  id `story:<id>`.
- Line-by-line English isn't part of the story JSON: the reader translates
  on demand, or an agent adds it after saving with `save_story_translations`
  (one English line per sentence; `get_story` shows how the text is split).
- The full prompt with a valid example is `buildStoryPrompt()` in
  `packages/shared/src/authoring.ts` (the editor's "Copy LLM prompt", and
  `get_authoring_guide` with kind `story`).

## Rules of thumb for generating content

- House style: everything the learner reads (prompts, instructions, hints,
  explanations, descriptions) is simple German at the set's level; only
  `subtitle` is a short English gloss. Tags are lowercase German keywords
  (`grammatik`, `dativ`, …); cheat sheet `category` is usually `grammatik`.
- Keep answers grammatically correct, and list valid variants in `accept`
  (but not case/umlaut/punctuation variants — grading already ignores those).
- Leave optional fields out rather than filling them with placeholder text.
- Give unique `id`s; keep set `id` filename-friendly.
- Prefer `cloze` for gap-fills (supports multiple blanks + cues), `transform`
  for rewrites, `sentence_build` for word-order.
- Structural checks are enforced on load/import — malformed content is rejected
  with a clear message, so validate by importing or by loading the app.
