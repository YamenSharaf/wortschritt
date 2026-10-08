import { z } from "zod";
import { checkCoverSvg } from "./cover";
import { cefrLevel, cheatsheet, exerciseItem, exerciseSet, series as seriesSchema, story } from "./exercises";

// --- covers -------------------------------------------------------------------

/** A cover SVG, checked (see `checkCoverSvg`). */
export const coverSvg = z
  .string()
  .min(1)
  .transform((s) => s.trim())
  .superRefine((s, ctx) => {
    for (const message of checkCoverSvg(s)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

/** Set (svg) or remove (null) a cover. */
export const setCoverBody = z.object({ svg: coverSvg.nullable() });


/** Choices offered for "generate N more" (in increments of 5). */
export const generateCounts = [5, 10, 15, 20] as const;
export const MAX_GENERATE_COUNT = 20;

/** How stories are displayed (Settings → per account, changed in the reader). */
export const readerSettings = z.object({
  font: z.enum(["serif", "sans", "readable"]).default("serif"),
  /** Text size in px. */
  size: z.number().int().min(14).max(30).default(19),
  lineHeight: z.enum(["compact", "normal", "relaxed"]).default("normal"),
  width: z.enum(["narrow", "medium", "wide"]).default("medium"),
  /** "auto" follows the app theme. */
  theme: z.enum(["auto", "light", "sepia", "dark"]).default("auto"),
  /** Underline words that are already in the learner's vocabulary. */
  highlightVocab: z.boolean().default(true),
  /** Read-aloud speed (1 = normal). */
  speechRate: z.number().min(0.6).max(1.4).default(0.95),
  /** English under each sentence: hidden, blurred until tapped, or shown. */
  translations: z.enum(["off", "peek", "always"]).default("off"),
  /** Turn pages like a book, or scroll. */
  layout: z.enum(["pages", "scroll"]).default("pages"),
});
export type ReaderSettings = z.infer<typeof readerSettings>;

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
  reader: readerSettings.default({}),
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

/** The server-wide time zone (IANA name) that "today" and days are counted in. */
export const timezoneSetting = z.object({ timezone: z.string().min(1).max(64) });
export type TimezoneSetting = z.infer<typeof timezoneSetting>;

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

/** One of a user's AI providers as shown in the app (never includes the key). */
export const aiProviderView = z.object({
  id: z.number(),
  name: z.string(),
  baseUrl: z.string(),
  hasKey: z.boolean(),
  /** A key is stored but can't be decrypted (ENCRYPTION_KEY changed): re-enter it. */
  keyUnreadable: z.boolean(),
});
export type AiProviderView = z.infer<typeof aiProviderView>;

/** One entry of the ordered model list (tried in order, falling back). */
export const aiModelEntry = z.object({
  id: z.number(),
  providerId: z.number(),
  model: z.string(),
});
export type AiModelEntry = z.infer<typeof aiModelEntry>;

export const aiSettingsView = z.object({
  /** ENCRYPTION_KEY is set, so keys can be stored. */
  encryptionAvailable: z.boolean(),
  providers: z.array(aiProviderView),
  /** In fallback order. */
  models: z.array(aiModelEntry),
});
export type AiSettingsView = z.infer<typeof aiSettingsView>;

export const saveAiProviderBody = z.object({
  name: z.string().trim().min(1).max(60),
  baseUrl: z.string().trim().min(1).max(500),
  /** New key; null removes the stored key; omitted keeps it. */
  apiKey: z.string().trim().min(1).max(1000).nullable().optional(),
});
export type SaveAiProviderBody = z.infer<typeof saveAiProviderBody>;

export const MAX_AI_MODELS = 10;
export const saveAiModelsBody = z.object({
  models: z
    .array(z.object({ providerId: z.number().int(), model: z.string().trim().min(1).max(200) }))
    .max(MAX_AI_MODELS),
});
export type SaveAiModelsBody = z.infer<typeof saveAiModelsBody>;

/** A model offered by a provider's model list. Prices are USD per 1M tokens. */
export const aiModelOption = z.object({
  id: z.string(),
  name: z.string().nullable(),
  contextLength: z.number().nullable(),
  promptPrice: z.number().nullable(),
  completionPrice: z.number().nullable(),
});
export type AiModelOption = z.infer<typeof aiModelOption>;

export const aiTestResult = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      provider: z.string(),
      model: z.string(),
      ok: z.boolean(),
      reply: z.string().optional(),
      error: z.string().optional(),
      ms: z.number(),
    }),
  ),
});
export type AiTestResult = z.infer<typeof aiTestResult>;

/** A personal API token as listed (the token itself is shown only once). */
export const apiTokenView = z.object({
  id: z.number(),
  name: z.string(),
  /** First characters, to recognise it, e.g. "mdb_Ab3xY". */
  prefix: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
});
export type ApiTokenView = z.infer<typeof apiTokenView>;
export const createTokenBody = z.object({ name: z.string().trim().min(1).max(60) });

/** An imported (shared-library) exercise set or cheat sheet. */
export const importedItem = z.object({
  id: z.string(),
  kind: z.enum(["exercise", "cheatsheet"]),
  title: z.string(),
  createdAt: z.string(),
  /** Username of the importer, or null if that account was deleted. */
  createdBy: z.string().nullable(),
  /** The signed-in user may delete it (their own import, or they're admin). */
  canDelete: z.boolean(),
});
export type ImportedItem = z.infer<typeof importedItem>;

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
/**
 * How an answer was judged: `auto` by the app's own checks, `ai` by the
 * learner's AI tutor, `self` by the learner (flashcards), `ungraded` = an open
 * answer nobody could judge (doesn't count towards accuracy).
 */
export const answerGrading = z.enum(["auto", "ai", "self", "ungraded"]);
export type AnswerGrading = z.infer<typeof answerGrading>;

export const attemptBody = z.object({
  setId: z.string().min(1),
  itemId: z.string().min(1),
  correct: z.boolean(),
  /** What the learner typed or chose. */
  response: z.string().max(2000).optional(),
  grading: answerGrading.default("auto"),
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

/** The consent screen for an OAuth (MCP connector) sign-in. */
export const oauthRequestView = z.object({
  client: z.object({
    name: z.string(),
    /** The client's homepage, if it gave one. */
    uri: z.string().nullable(),
    /** Where the browser goes after Allow/Deny. */
    redirectHost: z.string(),
  }),
  username: z.string(),
});
export type OAuthRequestView = z.infer<typeof oauthRequestView>;

/** Allow or deny; `params` is the authorization request's query string. */
export const oauthDecisionBody = z.object({
  params: z.record(z.string(), z.string()),
  approve: z.boolean(),
});

/** An app the user has connected (Settings → Connected apps). */
export const oauthGrantView = z.object({
  id: z.number().int(),
  clientName: z.string(),
  clientUri: z.string().nullable(),
  createdAt: z.number().int(),
  lastUsedAt: z.number().int().nullable(),
});
export type OAuthGrantView = z.infer<typeof oauthGrantView>;

// --- history ---------------------------------------------------------------

/** An item the learner got wrong, with what they answered. */
export const mistake = z.object({
  setId: z.string(),
  setTitle: z.string().nullable(),
  itemId: z.string(),
  /** The item as it is now (null if it was removed from the set). */
  item: exerciseItem.nullable(),
  wrongCount: z.number().int(),
  lastWrongAt: z.number().int(),
  /** Their most recent wrong answers, newest first (up to 3). */
  responses: z.array(z.string()),
  /** The latest attempt at this item was correct. */
  resolved: z.boolean(),
});
export type Mistake = z.infer<typeof mistake>;

export const activityEvent = z.object({
  at: z.number().int(),
  kind: z.enum(["run", "word_added", "note_created", "note_edited", "sheet_viewed", "story_added", "story_read"]),
  /** Set, word, note, sheet or story id (runs of a story's questions: "story:<id>"). */
  ref: z.string(),
  title: z.string(),
  /** For runs: "8/10". */
  detail: z.string().optional(),
});
export type ActivityEvent = z.infer<typeof activityEvent>;

export const activityDay = z.object({
  /** YYYY-MM-DD in the server time zone. */
  date: z.string(),
  answered: z.number().int(),
  correct: z.number().int(),
  wordsAdded: z.number().int(),
  wordsReviewed: z.number().int(),
});
export type ActivityDay = z.infer<typeof activityDay>;

export const activityView = z.object({
  timezone: z.string(),
  days: z.array(activityDay),
  events: z.array(activityEvent),
});
export type ActivityView = z.infer<typeof activityView>;

export const setHistory = z.object({
  setId: z.string(),
  setTitle: z.string().nullable(),
  runs: z.array(exerciseRun.extend({ id: z.number().int() })),
  items: z.array(
    z.object({
      itemId: z.string(),
      attempts: z.number().int(),
      correct: z.number().int(),
      lastResult: z.boolean().nullable(),
      lastResponse: z.string().nullable(),
    }),
  ),
});
export type SetHistory = z.infer<typeof setHistory>;

// --- stories ---------------------------------------------------------------

/** Exercise-history id of a story's questions (attempts and runs). */
export const storySetId = (id: string) => `story:${id}`;

/** A story's place in its book (null for a standalone story). */
export const storySeriesInfo = z.object({
  id: z.string(),
  title: z.string(),
  chapter: z.number().int(),
  /** Chapters planned (outline) or written, whichever is more. */
  total: z.number().int(),
  prev: z.string().nullable(),
  next: z.string().nullable(),
});
export type StorySeriesInfo = z.infer<typeof storySeriesInfo>;

export const storySummary = z.object({
  id: z.string(),
  /** Set when the story is a chapter of a series. */
  seriesId: z.string().nullable().default(null),
  chapter: z.number().int().nullable().default(null),
  title: z.string(),
  subtitle: z.string().optional(),
  level: cefrLevel,
  tags: z.array(z.string()),
  words: z.number().int(),
  questions: z.number().int(),
  /** Version of the cover art (changes with it), or null when there is none. */
  cover: z.string().nullable().default(null),
  /** How far the learner has scrolled (0–1). */
  progress: z.number(),
  readAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type StorySummary = z.infer<typeof storySummary>;

export const storyView = z.object({
  story,
  /** The book this story is a chapter of. */
  series: storySeriesInfo.nullable().default(null),
  progress: z.number(),
  readAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type StoryView = z.infer<typeof storyView>;

export const saveStoryBody = z.object({
  story,
  /** Replace an existing story with the same id. */
  overwrite: z.boolean().default(false),
});

export const storyProgressBody = z.object({
  progress: z.number().min(0).max(1),
  /** Mark as read (true) or unread (false); leave out to keep. */
  read: z.boolean().optional(),
});

/** Batch lemma lookup (offline dictionary): surface form → base form. */
export const lemmasBody = z.object({ words: z.array(z.string().min(1).max(64)).max(3000) });
export const lemmasResult = z.record(z.string(), z.string());

// --- online dictionary (Wiktionary via freedictionaryapi.com) --------------

/** Fuller dictionary data for a word, loaded after the instant offline gloss. */
export const wordDetails = z.object({
  /** The headword these entries are for (usually the base form). */
  word: z.string(),
  /** When the looked-up word is an inflection, e.g. "first/third-person
   *  singular preterite of gehen" (then `entries` are the base form's). */
  formOf: z.string().nullable(),
  entries: z.array(
    z.object({
      pos: z.string(),
      ipa: z.string().nullable(),
      senses: z.array(
        z.object({
          definition: z.string(),
          tags: z.array(z.string()),
          examples: z.array(z.string()),
        }),
      ),
    }),
  ),
  /** Attribution (Wiktionary content is CC BY-SA). */
  source: z.object({ url: z.string(), license: z.string(), licenseUrl: z.string() }),
});
export type WordDetails = z.infer<typeof wordDetails>;

// --- story generation ------------------------------------------------------

/** "Ein Tag am See!" → "ein-tag-am-see" (a valid story id). */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "story";
}

/** Target length in words. */
export const STORY_LENGTHS = { short: 150, medium: 350, long: 700 } as const;

/** Which of the learner's data the story should keep in mind. */
export const storyContextOptions = z.object({
  mistakes: z.boolean().default(true),
  vocab: z.boolean().default(true),
  topics: z.boolean().default(false),
});
export type StoryContextOptions = z.infer<typeof storyContextOptions>;

/** Exactly what is sent to the AI (shown as a preview before generating). */
export const storyContext = z.object({
  level: cefrLevel,
  /** Items the learner still gets wrong: the task, the right answer, theirs. */
  mistakes: z.array(
    z.object({ source: z.string(), task: z.string(), answer: z.string(), response: z.string().nullable() }),
  ),
  /** Saved words to work in (weakest flashcards and newest first). */
  words: z.array(z.string()),
  /** Recently practised exercise sets. */
  topics: z.array(z.string()),
});
export type StoryContext = z.infer<typeof storyContext>;

export const generateStoryBody = z.object({
  /** What the story should be about, in the learner's own words. */
  prompt: z.string().trim().min(3).max(2000),
  /** Defaults to the learner's level. */
  level: cefrLevel.optional(),
  length: z.enum(["short", "medium", "long"]).default("medium"),
  questions: z.number().int().min(0).max(8).default(4),
  /** "known": mostly words at or below the level; "stretch": ~5% new words, glossed. */
  vocabulary: z.enum(["known", "stretch"]).default("known"),
  context: storyContextOptions.default({}),
});
export type GenerateStoryBody = z.infer<typeof generateStoryBody>;

// --- story translations (line by line) ---------------------------------------

/** One paragraph's German sentences and their English lines (null = not yet). */
export const storyTranslationParagraph = z.object({
  index: z.number().int(),
  /** Plain-text German sentences, as the reader splits them. */
  sentences: z.array(z.string()),
  /** One English line per sentence — or a single line for the whole
   *  paragraph when the sentences couldn't be matched one to one. */
  lines: z.array(z.string()).nullable(),
});
export const storyTranslations = z.object({ paragraphs: z.array(storyTranslationParagraph) });
export type StoryTranslations = z.infer<typeof storyTranslations>;

/** Translate these paragraphs (by index) that aren't translated yet. */
export const translateStoryBody = z.object({
  paragraphs: z.array(z.number().int().min(0)).min(1).max(6),
});

/** Provide translations yourself (e.g. an agent): lines per paragraph. */
export const saveStoryTranslationsBody = z.object({
  paragraphs: z
    .array(z.object({ index: z.number().int().min(0), lines: z.array(z.string().min(1).max(1000)).min(1) }))
    .min(1),
});

// --- series (books in chapters) ----------------------------------------------


export const seriesChapter = z.object({
  chapter: z.number().int(),
  /** The chapter's story id, or null when only planned (outline). */
  storyId: z.string().nullable(),
  title: z.string(),
  level: cefrLevel.nullable(),
  words: z.number().int(),
  progress: z.number(),
  readAt: z.number().int().nullable(),
  /** Continuity summary (for writers). */
  summary: z.string().nullable(),
  /** Version of the cover art (changes with it), or null when there is none. */
  cover: z.string().nullable().default(null),
});
export type SeriesChapter = z.infer<typeof seriesChapter>;

export const seriesSummary = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  level: cefrLevel,
  description: z.string(),
  written: z.number().int(),
  total: z.number().int(),
  read: z.number().int(),
  /** Share of the book read, 0–1 (finished chapters count fully). */
  progress: z.number(),
  /** Where "Continue reading" goes (null when nothing is written yet). */
  continueId: z.string().nullable(),
  /** Version of the cover art (changes with it), or null when there is none. */
  cover: z.string().nullable().default(null),
  updatedAt: z.number().int(),
});
export type SeriesSummary = z.infer<typeof seriesSummary>;

export const seriesView = seriesSummary.extend({
  series: seriesSchema,
  chapters: z.array(seriesChapter),
});
export type SeriesView = z.infer<typeof seriesView>;

export const saveSeriesBody = z.object({
  series: seriesSchema,
  /** Replace the series with the same id (its chapters stay). */
  overwrite: z.boolean().default(false),
});

export const saveChapterBody = z.object({
  story,
  /** What happens, for later chapters' continuity (2–4 sentences). */
  summary: z.string().min(1).max(1500),
  overwrite: z.boolean().default(false),
});

