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

Both sources are merged by `id` at request time (DB imports win on collision).

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

- `id` (required, unique within the set)
- `instructions` (optional) — task line shown above the item
- `context` (optional) — a scenario/premise the item is based on, shown as a
  distinct quoted block above the prompt (e.g. "Die Presse möchte alles über
  die Hochzeit wissen."). It is also passed to the AI grader.
- `hint` (optional) — **always-visible** helper text (e.g. the words to use)
- `explanation` (optional) — shown after answering

### Text-answer grading (used by cloze, sentence_build, transform)

```jsonc
"answer": { "accept": ["muss"], "grading": "normalized" }
```

- `accept`: array of acceptable answers. **`accept[0]` is the canonical answer**
  shown to the learner.
- `grading`:
  - `normalized` (default) & `caseInsensitive` — both are **lenient**: they fold
    case and umlauts (ä→a, ö→o, ü→u, ß→ss) and ignore trailing punctuation. So
    "Muss"/"mussen" match "muss"/"müssen". The canonical spelling is shown anyway.
  - `exact` — byte-for-byte.
- When the learner's input isn't the exact canonical form (a miss, or a lenient
  accept), the app reveals `accept[0]` so they see the correct spelling.
- **AI grading:** on a local miss, if the AI tutor is configured and the
  `llmGrading` setting is on (the default), the tutor judges the answer, using
  `accept` as model answers. For **free-completion** items with many valid
  answers, list a few good examples in `accept` and say in `instructions` that
  any correct answer counts — see `content/exercises/infinitiv-zu-frei.json`.
  Without the tutor, such items only accept the listed answers.

## Item types

### `multiple_choice`
```jsonc
{ "type": "multiple_choice", "id": "q1", "prompt": "Ich sehe ___ Hund.",
  "choices": ["der", "den", "dem"], "answerIndex": 1, "explanation": "…" }
```

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
- Each column's `answers` must have **exactly one entry per row** (enforced).

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

## Rules of thumb for generating content

- German content; keep answers grammatically correct.
- Give unique `id`s; keep set `id` filename-friendly.
- Prefer `cloze` for gap-fills (supports multiple blanks + cues), `transform`
  for rewrites, `sentence_build` for word-order.
- Structural checks are enforced on load/import — malformed content is rejected
  with a clear message, so validate by importing or by loading the app.
