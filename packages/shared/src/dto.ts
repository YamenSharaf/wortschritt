import { z } from "zod";
import { cefrLevel, cheatsheet, exerciseSet } from "./exercises";

/** Choices offered for "generate N more" (in increments of 5). */
export const generateCounts = [5, 10, 15, 20] as const;
export const MAX_GENERATE_COUNT = 20;

/** User-configurable settings. Persisted as a single JSON row. */
export const settingsSchema = z.object({
  displayName: z.string().min(1).default("Learner"),
  level: cefrLevel.default("A1"),
  dailyGoal: z.number().int().min(1).max(500).default(20),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  /** Let the AI tutor grade free-text answers (only used when it's configured). */
  llmGrading: z.boolean().default(true),
  /** Default batch size for "generate N more" on the exercise-done screen. */
  generateCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_GENERATE_COUNT)
    .default(5),
  /** Preferred pronunciation voice. "" = the device's built-in TTS; otherwise
   *  a Piper voice id (needs the TTS sidecar). */
  ttsVoice: z.string().default(""),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Curated German Piper voices offered for download (also the download
 *  allowlist, so the /download proxy can't fetch arbitrary files). */
export const TTS_VOICE_CATALOG = [
  { id: "de_DE-thorsten-high", label: "Thorsten — high (male)" },
  { id: "de_DE-thorsten-medium", label: "Thorsten — medium (male)" },
  { id: "de_DE-eva_k-x_low", label: "Eva K (female)" },
  { id: "de_DE-kerstin-low", label: "Kerstin (female)" },
  { id: "de_DE-karlsson-low", label: "Karlsson (male)" },
  { id: "de_DE-ramona-low", label: "Ramona (female)" },
  { id: "de_DE-pavoque-low", label: "Pavoque (male)" },
] as const;
export const TTS_VOICE_IDS = TTS_VOICE_CATALOG.map((v) => v.id) as string[];

/** Pronunciation (Piper sidecar) status for the client. */
export const ttsStatus = z.object({
  /** Whether a TTS sidecar is configured. */
  available: z.boolean(),
  /** Voice ids currently downloaded/usable. */
  installed: z.array(z.string()),
  /** Downloadable voices (id + label). */
  catalog: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type TtsStatus = z.infer<typeof ttsStatus>;

/** Login: single shared password. */
export const loginBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

/** Minimum length for passwords set in the app. */
export const MIN_PASSWORD_LENGTH = 10;

/** Usernames: 2–32 letters, digits, `_`, `.`, `-` (matched case-insensitively). */
export const username = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_.-]{2,32}$/, "2–32 letters, digits, _ . or -");

const newPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(256);

export const registerBody = z.object({ username, password: newPassword });

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword,
});

export const registrationStatus = z.object({
  open: z.boolean(),
  /** Unix seconds when registration closes again, or null when closed. */
  openUntil: z.number().nullable(),
});
export type RegistrationStatus = z.infer<typeof registrationStatus>;
export const setRegistrationBody = z.object({ open: z.boolean() });

export const adminUser = z.object({
  id: z.number(),
  username: z.string(),
  role: z.enum(["admin", "user"]),
  disabled: z.boolean(),
  createdAt: z.number(),
  /** Unix seconds of the newest session start, or null if never signed in. */
  lastLoginAt: z.number().nullable(),
});
export type AdminUser = z.infer<typeof adminUser>;
export const updateUserBody = z.object({
  disabled: z.boolean().optional(),
  role: z.enum(["admin", "user"]).optional(),
});
export const adminSetPasswordBody = z.object({ password: newPassword });

export const authUser = z.object({
  username: z.string(),
  role: z.enum(["admin", "user"]),
});
export type AuthUserDto = z.infer<typeof authUser>;

export const meResponse = z.object({
  authenticated: z.boolean(),
  user: authUser.nullable(),
});

/** Record the result of answering one item. */
export const attemptBody = z.object({
  setId: z.string().min(1),
  itemId: z.string().min(1),
  correct: z.boolean(),
});
export type AttemptBody = z.infer<typeof attemptBody>;

/** Payload for the "paste JSON to import" admin screen. */
export const importBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exercise"), data: exerciseSet }),
  z.object({ kind: z.literal("cheatsheet"), data: cheatsheet }),
]);
export type ImportBody = z.infer<typeof importBody>;

/** Per-item correctness for one run, keyed by item id. */
export const runResults = z.record(z.string(), z.boolean());

/** Record one practice run (a pass through an exercise set). */
export const recordRunBody = z.object({
  setId: z.string().min(1),
  setTitle: z.string().min(1),
  total: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  results: runResults,
});
export type RecordRunBody = z.infer<typeof recordRunBody>;

/** Latest-run summary for a set (no per-item detail). */
export const runSummary = z.object({
  setId: z.string(),
  setTitle: z.string(),
  total: z.number().int(),
  answered: z.number().int(),
  correct: z.number().int(),
  finishedAt: z.number().int(),
});
export type RunSummary = z.infer<typeof runSummary>;

/** A full run including the per-item results (for the question navigator). */
export const exerciseRun = runSummary.extend({ results: runResults });
export type ExerciseRun = z.infer<typeof exerciseRun>;

/** Resumable in-progress position within an exercise set. */
export const exerciseProgress = z.object({
  setId: z.string(),
  index: z.number().int().nonnegative(),
  results: runResults,
  responses: z.record(z.string(), z.string()).default({}),
  updatedAt: z.number().int(),
});
export type ExerciseProgress = z.infer<typeof exerciseProgress>;

export const saveExerciseProgressBody = z.object({
  index: z.number().int().nonnegative(),
  results: runResults,
  responses: z.record(z.string(), z.string()).default({}),
});
export type SaveExerciseProgressBody = z.infer<typeof saveExerciseProgressBody>;

/** Record that a cheat sheet was viewed. */
export const sheetViewBody = z.object({
  sheetId: z.string().min(1),
  title: z.string().min(1),
});
export type SheetViewBody = z.infer<typeof sheetViewBody>;

export const sheetView = z.object({
  sheetId: z.string(),
  title: z.string(),
  viewedAt: z.number().int(),
});
export type SheetView = z.infer<typeof sheetView>;

/** One usage example: a German sentence and its English translation. */
export const vocabExample = z.object({
  de: z.string(),
  en: z.string(),
});
export type VocabExample = z.infer<typeof vocabExample>;

/** AI word lookup result (not yet saved). */
export const wordLookup = z.object({
  /** Dictionary base form (infinitive for verbs, nominative singular for
   *  nouns), so an inflected word like "trifft" is saved as "treffen". */
  lemma: z.string().optional(),
  translation: z.string(),
  examples: z.array(vocabExample),
  /** Part of speech (verb, noun, adjective, …), when the model reports it. */
  pos: z.string().optional(),
  /** Verbs: Partizip II (e.g. getroffen) and its perfect auxiliary. */
  partizip2: z.string().optional(),
  auxiliary: z.string().optional(),
  /** Nouns: article (der/die/das) and plural. */
  article: z.string().optional(),
  plural: z.string().optional(),
});
export type WordLookup = z.infer<typeof wordLookup>;

/** Ask the tutor to translate a word (optionally with its sentence). */
export const wordQueryBody = z.object({
  word: z.string().min(1).max(80),
  context: z.string().max(400).optional(),
  /** The learner's own definition — steers examples to that meaning. */
  meaning: z.string().max(200).optional(),
});
export type WordQueryBody = z.infer<typeof wordQueryBody>;

/** Flashcard self-assessment tally for one word (kept across sessions). */
export const vocabStat = z.object({
  known: z.number().int(),
  missed: z.number().int(),
  /** Most recent result: true = knew it, false = missed, null = never studied. */
  lastResult: z.boolean().nullable(),
  lastStudiedAt: z.number().int().nullable(),
});
export type VocabStat = z.infer<typeof vocabStat>;

/** Body for recording one flashcard grade. */
export const studyResultBody = z.object({ known: z.boolean() });
export type StudyResultBody = z.infer<typeof studyResultBody>;

/** Grammatical forms shown on a saved vocab word. Offline data supplies pos,
 *  article, plural and Partizip II; the AI adds the perfect auxiliary. */
export const vocabForms = z.object({
  pos: z.string().nullable(),
  article: z.string().nullable(),
  plural: z.string().nullable(),
  partizip2: z.string().nullable(),
  /** Perfect-tense auxiliary for verbs: "haben" or "sein" (AI-supplied). */
  auxiliary: z.string().nullable(),
});
export type VocabForms = z.infer<typeof vocabForms>;

/** AI-supplied grammatical forms persisted with a saved word (all optional). */
export const vocabFormsInput = z.object({
  pos: z.string().optional(),
  article: z.string().optional(),
  plural: z.string().optional(),
  partizip2: z.string().optional(),
  auxiliary: z.string().optional(),
});
export type VocabFormsInput = z.infer<typeof vocabFormsInput>;

/** A saved vocabulary entry. */
export const vocabEntry = z.object({
  word: z.string(),
  display: z.string(),
  translation: z.string(),
  examples: z.array(vocabExample),
  createdAt: z.number().int(),
  /** Ids of the groups this word belongs to. */
  groups: z.array(z.number().int()).default([]),
  /** Flashcard tally, or null if never studied. */
  stats: vocabStat.nullable().default(null),
  /** Grammatical forms (Partizip II, article, plural), derived offline. */
  forms: vocabForms.nullable().default(null),
});
export type VocabEntry = z.infer<typeof vocabEntry>;

/** A named vocab collection. */
export const vocabGroup = z.object({
  id: z.number().int(),
  name: z.string(),
  count: z.number().int(),
  createdAt: z.number().int(),
});
export type VocabGroup = z.infer<typeof vocabGroup>;

export const createGroupBody = z.object({ name: z.string().min(1).max(60) });
export const groupWordBody = z.object({ word: z.string().min(1).max(80) });

/** Add/update a saved word. */
export const saveVocabBody = z.object({
  word: z.string().min(1).max(80),
  display: z.string().min(1).max(80).optional(),
  translation: z.string().min(1),
  examples: z.array(vocabExample).default([]),
  /** AI-supplied grammatical forms to persist (e.g. the perfect auxiliary). */
  forms: vocabFormsInput.optional(),
});
export type SaveVocabBody = z.infer<typeof saveVocabBody>;

/** Offline dictionary lookup result for one tapped word. */
export const dictEntry = z.object({
  /** The cleaned surface form that was looked up. */
  surface: z.string(),
  /** Dictionary base form (infinitive / nominative singular). */
  lemma: z.string(),
  /** Part of speech (verb, noun, adj, adv, prep, …). */
  pos: z.string(),
  /** der/die/das for nouns, else null. */
  article: z.string().nullable().optional(),
  /** Nominative plural for nouns, else null. */
  plural: z.string().nullable().optional(),
  /** Partizip II for verbs (e.g. treffen → getroffen), else null. */
  partizip2: z.string().nullable().optional(),
  /** Short English gloss when the lemma is in the curated core, else null. */
  gloss: z.string().nullable().optional(),
});
export type DictEntry = z.infer<typeof dictEntry>;

/** A free-form learning note (Markdown body), auto-saved. */
export const note = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  body: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Note = z.infer<typeof note>;

/** Create a note (everything optional — starts blank, filled as you type). */
export const createNoteBody = z.object({
  title: z.string().max(200).default("Untitled"),
  category: z.string().max(80).default(""),
  body: z.string().default(""),
});
export type CreateNoteBody = z.infer<typeof createNoteBody>;

/** Update a note (partial — auto-save sends whichever fields changed). */
export const saveNoteBody = z.object({
  title: z.string().max(200).optional(),
  category: z.string().max(80).optional(),
  body: z.string().optional(),
});
export type SaveNoteBody = z.infer<typeof saveNoteBody>;

/** Aggregated progress returned to the dashboard. */
export const progressSummary = z.object({
  totalAnswered: z.number().int(),
  totalCorrect: z.number().int(),
  answeredToday: z.number().int(),
  dailyGoal: z.number().int(),
  perSet: z.array(
    z.object({
      setId: z.string(),
      answered: z.number().int(),
      correct: z.number().int(),
    }),
  ),
});
export type ProgressSummary = z.infer<typeof progressSummary>;
