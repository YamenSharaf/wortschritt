/**
 * What the app is and how it works, for agents (MCP `get_app_guide`). Kept
 * out of the always-sent instructions so it only costs context when an
 * agent asks for it. Keep it in step with the app when features change.
 */
export const APP_GUIDE = `# Wortschritt — how the app works

A small self-hosted app for learning German, used by a few people (one admin). You act as one signed-in user: what you change is what they see in the app. Everything the learner reads is German at their level (whoami / get_progress); explanations to them are in English.

## Areas (web app nav: Home · Practice · Sheets · Stories · Vocab · Notes; settings in the account menu at the top right)
- Home: today's answers vs. their daily goal, totals and accuracy, recent practice, recently viewed sheets, recent notes.
- Sheets (shared): grammar cheat sheets in Markdown.
- Practice (shared): exercise sets — multiple choice, cloze, flashcard, sentence building, transform, true/false, conjugation tables. Answers are graded in the app (forgiving: case, punctuation, ä→a are ignored unless an item says "exact"); open answers can be graded by the learner's AI tutor if they enabled it. Every answer is recorded. AI helpers in the player: hint, translate the task, "why was I wrong?", and "generate more" items at the end.
- Stories (private): reading texts with a glossary and comprehension questions at the end, and Books (series of chapters) shown as a grid of covers or a list. The reader has pages or scroll, tap-a-word dictionary popup (save to vocab from there), English line by line (off / peek / always), read-aloud, text settings, and EPUB download. Stories can also be generated in the app from a short prompt (Stories → Generate) or written by hand.
- Vocab (private): saved words (by base form) with groups, and flashcards (all words or a group, DE↔EN, "know / don't know"). There is no spaced-repetition schedule: each word keeps known/missed counts and its last result.
- Notes (private): Markdown notes with free-form categories; "Clean up" tidies a note with AI.
- Settings (account menu): Learning (level, daily goal, batch size, voice), Account (display name, password), Connections (AI tutor: each user brings their own OpenAI-compatible provider; connected apps; API tokens). Administration (admin only): users and registration; server time zone and read-aloud voices.
- Import (button on Practice and Cheat sheets): paste JSON content (the same format as get_authoring_guide).

## Shared vs. private
Exercise sets and cheat sheets are a shared library: built-in ones are read-only; imported ones can be replaced or deleted only by whoever imported them (an admin can delete any). Stories, books, covers, vocab, notes and progress belong to this user alone.

## Data you can use
- get_progress: per-set results and totals. get_activity: what they did when (practice, reading, reviews, notes).
- get_mistakes: items they answered wrong and still get wrong, with their wrong answers — the best basis for targeted practice. Story questions count too ("story:<id>").
- get_story_context: their level, recent mistakes, words they're learning and recent practice — for writing stories that fit them.
- list_vocab / get_vocab: saved words with known/missed counts.

## Typical tasks
- Targeted practice: get_mistakes → get_authoring_guide kind "exercise" → list_exercise_sets (pick an unused id) → validate_content → save_exercise_set. Practise the same weak points with new sentences; don't copy their old items.
- A story for them: get_story_context → get_authoring_guide kind "story" → save_story → save_story_translations (English line by line).
- A book: get_authoring_guide kind "series" → save_series (bible + outline) → per chapter (also in parallel by sub-agents): get_series → save_chapter → save_story_translations. Then read the summaries for continuity and fix chapters with overwrite. Covers: get_authoring_guide kind "cover" → set_cover for the book and each chapter, as one consistent set.
- Vocabulary: save_vocab, create_vocab_group, add_words_to_group (e.g. a group of the words from a story).
- Notes: list_notes / get_note, update_note (keep their content; tidy and correct it).

## House rules
- German at the learner's level; weave grammar they struggle with in naturally, never name or lecture it in the text.
- Never put the answer into a hint, instructions, glossary entry or label.
- Don't delete or overwrite the learner's things unless they asked.
- Tell them where to find what you made, e.g. "Stories → Books → <title>" or "Practice → <set title>".`;
