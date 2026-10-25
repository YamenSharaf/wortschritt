import { z } from "zod";
import { checkCoverSvg } from "./cover";
import { itemResponse } from "./answers";
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
  font: z.enum(["serif", "sans", "readable", "libron"]).default("serif"),
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
   *  a server voice id ("azure:…", "edge:…" or "gemini:…"). */
  ttsVoice: z.string().default(""),
  /** The story reader's "Read aloud": "" = the same as ttsVoice, "device" = the device's own, else a server voice id. */
  readerVoice: z.string().default(""),
  /** Audiobooks: made ahead of time by the server (with keys meant for the background), keeping `reserve` of each key's day for this learner. */
  audiobooks: z
    .object({
      auto: z.boolean().default(false),
      reserve: z.number().min(0).max(0.9).default(0.2),
    })
    .default({}),
  reader: readerSettings.default({}),
  /** The account icon: a pixel pattern from the name (the seed picks another one) or the initial. */
  avatar: z
    .object({
      style: z.enum(["pattern", "letter"]).default("pattern"),
      seed: z.number().int().min(0).max(1_000_000).default(0),
    })
    .default({}),
});
export type Settings = z.infer<typeof settingsSchema>;

/** What can be a favourite: exercise sets and cheat sheets from the library. */
export const favoriteKind = z.enum(["exercise", "cheatsheet"]);
export type FavoriteKind = z.infer<typeof favoriteKind>;
export const favorite = z.object({ kind: favoriteKind, id: z.string().min(1), createdAt: z.number().int() });
export type Favorite = z.infer<typeof favorite>;

/**
 * German neural voices offered by the cloud providers (Azure Speech and the
 * Edge "Read aloud" endpoint share them). Voice ids in settings carry the
 * provider: "azure:de-DE-KatjaNeural", "edge:de-DE-KatjaNeural".
 */
export const NEURAL_VOICES = [
  { name: "de-DE-KatjaNeural", label: "Katja (female)" },
  { name: "de-DE-ConradNeural", label: "Conrad (male)" },
  { name: "de-DE-SeraphinaMultilingualNeural", label: "Seraphina (female)" },
  { name: "de-DE-FlorianMultilingualNeural", label: "Florian (male)" },
  { name: "de-DE-AmalaNeural", label: "Amala (female)" },
  { name: "de-DE-KillianNeural", label: "Killian (male)" },
] as const;
/** Azure's high-definition (Dragon HD) German voices: Azure only, not through Edge. */
export const AZURE_HD_VOICES = [
  { name: "de-DE-Seraphina:DragonHDLatestNeural", label: "Seraphina HD (female)" },
  { name: "de-DE-Florian:DragonHDLatestNeural", label: "Florian HD (male)" },
] as const;
/**
 * Gemini's prebuilt voices (they speak German too), with Google's own word
 * for how each sounds. A choice of the calmer, clearer ones for learning.
 */
export const GEMINI_VOICES = [
  { name: "Kore", label: "Kore (firm)" },
  { name: "Aoede", label: "Aoede (breezy)" },
  { name: "Leda", label: "Leda (youthful)" },
  { name: "Sulafat", label: "Sulafat (warm)" },
  { name: "Achernar", label: "Achernar (soft)" },
  { name: "Vindemiatrix", label: "Vindemiatrix (gentle)" },
  { name: "Charon", label: "Charon (informative)" },
  { name: "Iapetus", label: "Iapetus (clear)" },
  { name: "Orus", label: "Orus (firm)" },
  { name: "Schedar", label: "Schedar (even)" },
  { name: "Gacrux", label: "Gacrux (mature)" },
  { name: "Puck", label: "Puck (upbeat)" },
] as const;
/** Gemini text-to-speech models to choose from (the newest first). */
export const GEMINI_TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"] as const;
/** The voices a provider offers. */
export function serverVoices(provider: TtsProvider): readonly { name: string; label: string }[] {
  if (provider === "gemini") return GEMINI_VOICES;
  return provider === "azure" ? [...NEURAL_VOICES, ...AZURE_HD_VOICES] : NEURAL_VOICES;
}
/**
 * A story read aloud as one audio file (an audiobook), made on demand in the
 * reading voice. `key` names the file and changes with the text or the voice;
 * `starts[i]` is where paragraph i (storyParagraphs) begins, in seconds.
 */
export const storyAudio = z.object({
  /** "waiting": the voice's limit is used up for now; it carries on by itself at `retryAt`. */
  state: z.enum(["none", "building", "waiting", "ready", "error"]),
  /** The reading voice, or null when it isn't a server voice (no file can be made). */
  voice: z.string().nullable(),
  /** While building: clips made so far, of how many. */
  done: z.number().int(),
  total: z.number().int(),
  error: z.string().nullable(),
  key: z.string().nullable(),
  duration: z.number(),
  bytes: z.number().int(),
  starts: z.array(z.number()),
  /** While waiting: when it tries again (unix seconds). */
  retryAt: z.number().int().nullable().default(null),
  /** While waiting: which limit, as the provider says it ("Gemini's daily limit: 100 requests a day…"). */
  waitReason: z.string().nullable().default(null),
  /** Until it's ready: how many paragraphs from the start are made already (they can be listened to), of how many. */
  readyParagraphs: z.number().int().default(0),
  paragraphs: z.number().int().default(0),
});
export type StoryAudio = z.infer<typeof storyAudio>;
/** A story's audio in short, for lists (cards, a book's chapters). */
export const storyAudioBrief = storyAudio.pick({ state: true, done: true, total: true, duration: true, retryAt: true, waitReason: true });
export type StoryAudioBrief = z.infer<typeof storyAudioBrief>;
/** The paragraphs made so far, from the start, as a file to listen to while the rest waits. */
export const partialStoryAudio = z.object({
  key: z.string(),
  duration: z.number(),
  starts: z.array(z.number()),
  /** Paragraphs in it, of the story's. */
  paragraphs: z.number().int(),
  of: z.number().int(),
});
export type PartialStoryAudio = z.infer<typeof partialStoryAudio>;

export const ttsProvider = z.enum(["azure", "edge", "gemini"]);
export type TtsProvider = z.infer<typeof ttsProvider>;

/** Which provider a voice id belongs to (null: not a server voice). */
export function ttsProviderOf(voice: string): TtsProvider | null {
  if (voice.startsWith("azure:")) return "azure";
  if (voice.startsWith("edge:")) return "edge";
  if (voice.startsWith("gemini:")) return "gemini";
  return null;
}

/** Pronunciation status for the client. */
export const ttsStatus = z.object({
  /** Whether any server voice is usable. */
  available: z.boolean(),
  /** Voice ids usable now. */
  installed: z.array(z.string()),
  /** Every usable server voice, for the voice picker. */
  voices: z.array(z.object({ id: z.string(), label: z.string(), provider: ttsProvider })).default([]),
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

/**
 * How an answer was judged: `auto` by the app's own checks, `ai` by the
 * learner's AI tutor, `self` by the learner (flashcards), `ungraded` = an open
 * answer nobody could judge (doesn't count towards accuracy).
 */
export const answerGrading = z.enum(["auto", "ai", "self", "ungraded"]);
export type AnswerGrading = z.infer<typeof answerGrading>;

/** The verdict on one answer, with the tutor's comment when it judged it. */
export const answerVerdict = z.object({
  correct: z.boolean(),
  grading: answerGrading,
  feedback: z.string().optional(),
  /** Wrong, but only by a small slip (a translation the tutor judged). */
  almost: z.boolean().optional(),
  /** The learner's answer with the fewest changes that make it right. */
  corrected: z.string().optional(),
});
export type AnswerVerdict = z.infer<typeof answerVerdict>;

/**
 * Answer one item: the server finds it (a library set, the learner's own
 * generated items, or a story's questions as set "story:<id>"), grades it,
 * records it and adds it to the set's current session.
 */
export const answerBody = z.object({
  setId: z.string().min(1),
  itemId: z.string().min(1),
  response: itemResponse,
});
export type AnswerBody = z.infer<typeof answerBody>;

/** Payload for the "paste JSON to import" admin screen. */
export const importBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exercise"), data: exerciseSet }),
  z.object({ kind: z.literal("cheatsheet"), data: cheatsheet }),
]);
export type ImportBody = z.infer<typeof importBody>;

/** Per-item correctness for one run, keyed by item id. */
export const runResults = z.record(z.string(), z.boolean());

/**
 * End a pass through a set: the server turns its session into a run (score
 * and per-item results). `done`: the learner reached the end, so the session
 * is cleared; otherwise they left early and can resume it.
 */
export const finishRunBody = z.object({
  setId: z.string().min(1),
  done: z.boolean(),
});
export type FinishRunBody = z.infer<typeof finishRunBody>;

/** "Generate more": the server writes new items for a set and keeps them for this learner. */
export const generateMoreBody = z.object({
  count: z.number().int().min(1).max(MAX_GENERATE_COUNT).default(5),
});
export const generateMoreResult = z.object({
  /** The new items (already saved). */
  items: z.array(exerciseItem),
  /** How many items the model returned, valid or not. */
  received: z.number().int(),
});
export type GenerateMoreResult = z.infer<typeof generateMoreResult>;

/** Latest-run summary for a set (no per-item detail). */
/** What a set id points at: a library exercise set, or a story's questions ("story:<id>"). */
export const setKind = z.enum(["exercise", "story"]);
/** How a score reads, decided by the server: good ≥ 80%, ok ≥ 50%, weak below. */
export const scoreTier = z.enum(["good", "ok", "weak"]);

export const runSummary = z.object({
  setId: z.string(),
  setTitle: z.string(),
  total: z.number().int(),
  answered: z.number().int(),
  correct: z.number().int(),
  finishedAt: z.number().int(),
  kind: setKind.default("exercise"),
  /** Null when nothing graded was answered. */
  tier: scoreTier.nullable().default(null),
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
  /** Answered items nobody could judge (open answers without a tutor). */
  ungraded: z.array(z.string()).default([]),
  updatedAt: z.number().int(),
});
export type ExerciseProgress = z.infer<typeof exerciseProgress>;

/** Where the learner is in a set; answers reach the session via answerBody. */
export const saveExerciseProgressBody = z.object({
  index: z.number().int().nonnegative(),
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

/** How a saved word is keyed (its `word`): "Der Hund " and "der hund" are the same entry. */
export const vocabKey = (word: string) => word.trim().toLowerCase();

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

/**
 * An English word in German, for translation exercises: `de` as a learner
 * notes it (the article with a noun, "der Bahnhof"; the infinitive for a
 * verb, with "sich" when reflexive), `lemma` the German base form to save.
 */
export const germanWord = z.object({
  de: z.string(),
  lemma: z.string(),
  en: z.string(),
  pos: z.string().optional(),
  article: z.string().optional(),
});
export type GermanWord = z.infer<typeof germanWord>;

/** Ask the tutor for the German of an English word, in its sentence. */
export const germanWordBody = z.object({
  word: z.string().min(1).max(80),
  context: z.string().max(400).optional(),
});

/** Largest file a note can carry. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** A file kept with a note (a transcript, a photo of the board, a PDF, a recording). */
export const noteAttachment = z.object({
  id: z.string(),
  name: z.string(),
  /** Media type, e.g. "text/plain", "image/jpeg", "application/pdf". */
  type: z.string(),
  size: z.number().int(),
  createdAt: z.number().int(),
});
export type NoteAttachment = z.infer<typeof noteAttachment>;

/** A free-form learning note (Markdown body), auto-saved. */
export const note = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  body: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  /** Files kept with it, oldest first (left out by older servers, and on notes made offline). */
  attachments: z.array(noteAttachment).optional(),
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
  /** Answers still needed today (0 once the goal is met). */
  goalLeft: z.number().int().default(0),
  /** Today's goal reached, 0–100. */
  goalPercent: z.number().int().default(0),
  /** Share of graded answers that were right, 0–100; null before any. */
  accuracy: z.number().int().nullable().default(null),
  /**
   * Where "Continue practice" goes: the most recently touched of an
   * unfinished set (resume) and the last finished run's set; null before any.
   */
  continue: z
    .object({ setId: z.string(), title: z.string(), kind: setKind, resume: z.boolean() })
    .nullable()
    .default(null),
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

/** An app the user has connected (Settings → Connections). */
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

/**
 * Where the learner is with a story or book, decided by the server: "reading"
 * once they're past the first 2%, "read" once marked read (finished, the quiz
 * done, or "Next chapter").
 */
export const readingStatus = z.enum(["unread", "reading", "read"]);
export type ReadingStatus = z.infer<typeof readingStatus>;

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
  /** Reading time at a learner's pace (about 120 words a minute), at least 1. */
  minutes: z.number().int().default(1),
  questions: z.number().int(),
  /** Version of the cover art (changes with it), or null when there is none. */
  cover: z.string().nullable().default(null),
  /** How far the learner has read (0–1); only moves forward until "Read again". */
  progress: z.number(),
  readAt: z.number().int().nullable(),
  status: readingStatus.default("unread"),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type StorySummary = z.infer<typeof storySummary>;

export const storyView = z.object({
  story,
  /** The book this story is a chapter of. */
  series: storySeriesInfo.nullable().default(null),
  /** Reading time at a learner's pace (about 120 words a minute), at least 1. */
  minutes: z.number().int().default(1),
  progress: z.number(),
  readAt: z.number().int().nullable(),
  status: readingStatus.default("unread"),
  /** Where the reader should reopen (0–1), or null to start at the top. */
  resumeAt: z.number().nullable().default(null),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type StoryView = z.infer<typeof storyView>;

export const saveStoryBody = z.object({
  story,
  /** Replace an existing story with the same id. */
  overwrite: z.boolean().default(false),
});

/** How far the learner has read; the server keeps the further position. */
export const storyProgressBody = z.object({
  progress: z.number().min(0).max(1),
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
  /** Reading time (0 when not written yet). */
  minutes: z.number().int().default(0),
  progress: z.number(),
  readAt: z.number().int().nullable(),
  status: readingStatus.default("unread"),
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
  /** "read" once every planned chapter is read. */
  status: readingStatus.default("unread"),
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


// --- native app ---------------------------------------------------------------

/** GET /api/version: the API's version and the oldest app version it serves. */
export const apiVersion = z.object({
  api: z.number().int(),
  minClient: z.number().int(),
  appName: z.string(),
});
export type ApiVersion = z.infer<typeof apiVersion>;

// --- read-aloud providers (admin) ----------------------------------------------

/** What a request for speech is for: the audiobook queue, someone waiting to listen, or a tap on a word or sentence. */
export const TTS_PURPOSES = ["background", "waiting", "taps"] as const;
export type TtsPurpose = (typeof TTS_PURPOSES)[number];

/** A voice key (Gemini or Azure) as its owner sees it (never the key itself). */
export const ttsKeyView = z.object({
  id: z.number().int(),
  provider: z.enum(["gemini", "azure"]),
  /** Azure's region. */
  region: z.string().nullable(),
  label: z.string(),
  /** "free": a project without billing; "paid": one with billing (each request costs). */
  kind: z.enum(["free", "paid"]),
  /** The key's last four characters, to tell keys apart. */
  hint: z.string(),
  /** It can't be decrypted any more (ENCRYPTION_KEY changed): enter it again. */
  unreadable: z.boolean(),
});
export type TtsKeyView = z.infer<typeof ttsKeyView>;

/** One entry of the order: a key and a model, what it may be used for, and how much of today's limit is used. */
export const ttsEntryView = z.object({
  id: z.number().int(),
  keyId: z.number().int(),
  model: z.enum(GEMINI_TTS_MODELS),
  background: z.boolean(),
  waiting: z.boolean(),
  taps: z.boolean(),
  /** Requests this server made with it today (Google's day: midnight Pacific), of its daily limit. */
  usedToday: z.number().int(),
  dailyLimit: z.number().int(),
  /** Seconds of audio it made today (for an idea of the cost). */
  secondsToday: z.number(),
  /** At a limit until then (unix seconds), and which one. */
  limitedUntil: z.number().int().nullable(),
  limitReason: z.string().nullable(),
});
export type TtsEntryView = z.infer<typeof ttsEntryView>;

/** The server's read-aloud providers, as the admin sees them. */
export const ttsAdminSettings = z.object({
  azure: z.object({
    configured: z.boolean(),
    region: z.string(),
    /** Whether keys can be stored (ENCRYPTION_KEY is set). */
    canStoreKey: z.boolean(),
  }),
  edge: z.object({ enabled: z.boolean() }),
  gemini: z.object({
    keys: z.array(ttsKeyView),
    /** In the order they're tried. */
    entries: z.array(ttsEntryView),
  }),
  /** Who may use the server's keys: everyone, everyone but only its free keys, or admins only. */
  share: z.enum(["all", "free", "admins"]),
  /** When every Gemini entry is used up, read taps with Edge's Katja (never story audio). */
  edgeFallback: z.boolean(),
});
export type TtsAdminSettings = z.infer<typeof ttsAdminSettings>;

/** A learner's own voice keys and order, and what of the server's comes after them. */
export const myVoices = z.object({
  canStoreKey: z.boolean(),
  keys: z.array(ttsKeyView),
  /** Their order for Gemini voices (their own keys only). */
  entries: z.array(ttsEntryView),
  /** The server's entries tried after theirs (as far as they may use them), and whether the server's Azure is theirs to use. */
  server: z.object({
    entries: z.array(z.object({ label: z.string(), model: z.string(), kind: z.enum(["free", "paid"]), uses: z.array(z.enum(TTS_PURPOSES)) })),
    azure: z.boolean(),
  }),
});
export type MyVoices = z.infer<typeof myVoices>;


export const ttsKeyBody = z.object({
  provider: z.enum(["gemini", "azure"]).default("gemini"),
  /** Azure's region ("swedencentral"). */
  region: z
    .string()
    .trim()
    .regex(/^[a-z0-9]{2,30}$/, "an Azure region like swedencentral")
    .optional(),
  label: z.string().trim().min(1).max(40),
  kind: z.enum(["free", "paid"]),
  /** Required when adding; omitted keeps the stored one. */
  key: z.string().trim().min(10).max(200).optional(),
});
export const ttsEntriesBody = z.object({
  entries: z
    .array(
      z.object({
        keyId: z.number().int(),
        model: z.enum(GEMINI_TTS_MODELS),
        background: z.boolean(),
        waiting: z.boolean(),
        taps: z.boolean(),
      }),
    )
    .max(12),
});

/** Change providers: Azure (key optional to keep the stored one; null removes it), Edge on/off, Gemini. */
export const ttsAdminBody = z.object({
  azure: z
    .object({
      region: z.string().trim().regex(/^[a-z0-9]{2,30}$/, "an Azure region like westeurope"),
      key: z.string().trim().min(10).max(200).optional(),
    })
    .nullable()
    .optional(),
  edge: z.boolean().optional(),
  share: z.enum(["all", "free", "admins"]).optional(),
  edgeFallback: z.boolean().optional(),
});

/** Try a voice: synthesizes a short sentence. */
export const ttsTestBody = z.object({ voice: z.string().min(1).max(100) });

// --- sync (native app) -----------------------------------------------------------

/** A story as the app keeps it offline: the view, its cover version, English lines and word count. */
export const syncStory = storyView.extend({
  cover: z.string().nullable(),
  translations: storyTranslations.nullable(),
  /** As in the story list (StorySummary.words). */
  words: z.number().int().default(0),
});
export type SyncStory = z.infer<typeof syncStory>;

/** GET /api/sync/changes: what changed since `since` (or everything). */
export const syncChangesQuery = z.object({
  /** The cursor from the last sync; omit for a full snapshot. */
  since: z.string().regex(/^\d+$/).optional(),
  /** The library version the app has; the library is sent when it differs. */
  library: z.string().max(64).optional(),
});

/**
 * Numbers the server computes for the learner (Home and Practice), sent on
 * every pull so the app shows them offline without computing anything.
 */
export const syncStats = z.object({
  /** As GET /api/progress (today's answers vs the goal, totals, per set). */
  progress: progressSummary,
  /** The latest run per set, newest first (as GET /api/runs). */
  runs: z.array(runSummary),
  /** Recently opened cheat sheets, newest first (as GET /api/sheet-views). */
  sheetViews: z.array(sheetView),
  /** Where the learner stopped in each unfinished set. */
  exerciseProgress: z.array(exerciseProgress),
});
export type SyncStats = z.infer<typeof syncStats>;

export const syncChanges = z.object({
  /** Pass back as `since` next time. */
  cursor: z.string(),
  /** A full snapshot: replace local data with this (first sync, or the app was offline too long). */
  full: z.boolean(),
  /** More changes are waiting: call again with the new cursor. */
  more: z.boolean(),
  /** The whole shared library, only when it changed (or on a full snapshot). */
  library: z
    .object({
      version: z.string(),
      exerciseSets: z.array(exerciseSet),
      cheatsheets: z.array(cheatsheet),
      /** Ids of the read-only built-in items. */
      builtIn: z.array(z.string()),
    })
    .nullable(),
  stories: z.array(syncStory),
  series: z.array(seriesView),
  vocab: z.array(vocabEntry),
  groups: z.array(vocabGroup),
  notes: z.array(note),
  /** The learner's generated items, all of a set's whenever any changed. */
  generated: z.array(z.object({ setId: z.string(), items: z.array(exerciseItem) })),
  /** The learner's settings, when they changed. */
  settings: settingsSchema.nullable(),
  /** All of the learner's favourites (newest first), when any changed. */
  favorites: z.array(favorite).nullable(),
  deleted: z.object({
    stories: z.array(z.string()),
    series: z.array(z.string()),
    vocab: z.array(z.string()),
    groups: z.array(z.string()),
    notes: z.array(z.string()),
    /** Sets whose generated items were all removed. */
    generated: z.array(z.string()),
  }),
  /** Always current, computed after everything above. */
  stats: syncStats,
});
export type SyncChanges = z.infer<typeof syncChanges>;

/**
 * An action the app did offline, replayed by POST /api/sync/push. `opId` is
 * the app's own id for it (e.g. a UUID): replays of the same op are applied
 * once.
 */
const opId = z.string().min(8).max(64);
export const syncOp = z.discriminatedUnion("type", [
  /**
   * Graded by the server's own rules (no AI tutor), like the app's offline
   * verdict. `at`: when it was answered (unix seconds, capped at now), so it
   * counts towards that day.
   */
  z.object({ opId, type: z.literal("answer"), at: z.number().int(), data: answerBody }),
  z.object({ opId, type: z.literal("finish"), data: finishRunBody }),
  z.object({ opId, type: z.literal("sheetView"), data: sheetViewBody }),
  /**
   * Progress only moves forward (max of server and app). `at`: when (unix
   * seconds); skipped as stale if the story was marked read or read again since.
   */
  z.object({ opId, type: z.literal("storyProgress"), storyId: z.string().min(1), progress: z.number().min(0).max(1), at: z.number().int() }),
  /** Mark read (`read: true`) or "Read again" (false: unread, back to the start); stale when the read state changed later. */
  z.object({ opId, type: z.literal("storyRead"), storyId: z.string().min(1), read: z.boolean(), at: z.number().int() }),
  z.object({ opId, type: z.literal("vocabSave"), data: saveVocabBody }),
  z.object({ opId, type: z.literal("vocabRemove"), word: z.string().min(1) }),
  z.object({ opId, type: z.literal("vocabStudy"), word: z.string().min(1), known: z.boolean() }),
  z.object({ opId, type: z.literal("noteCreate"), data: createNoteBody }),
  /**
   * `baseUpdatedAt`: the note's updatedAt the app edited from. If the server's
   * note changed since, the app's version is saved as a conflict copy instead.
   */
  z.object({ opId, type: z.literal("noteUpdate"), id: z.string().min(1), baseUpdatedAt: z.number().int(), data: saveNoteBody }),
  z.object({ opId, type: z.literal("noteDelete"), id: z.string().min(1) }),
  /**
   * Where the learner stopped in a set, or that they finished it (clear).
   * `at`: when it happened (unix seconds); skipped (`stale`) when the server's
   * position for that set is newer, e.g. from the web in the meantime.
   */
  z.object({ opId, type: z.literal("exerciseProgressSave"), setId: z.string().min(1), at: z.number().int(), data: saveExerciseProgressBody }),
  z.object({ opId, type: z.literal("exerciseProgressClear"), setId: z.string().min(1), at: z.number().int() }),
  /** Star or unstar a set or sheet; the later of two changes to the same one wins. */
  z.object({ opId, type: z.literal("favorite"), kind: favoriteKind, id: z.string().min(1), on: z.boolean(), at: z.number().int() }),
]);
export type SyncOp = z.infer<typeof syncOp>;

export const syncPushBody = z.object({ ops: z.array(syncOp).min(1).max(500) });

export const syncOpResult = z.object({
  opId: z.string(),
  ok: z.boolean(),
  /** Already applied by an earlier push (this is that result). */
  duplicate: z.boolean().default(false),
  error: z.string().optional(),
  /** E.g. a created note's id, or a conflict copy's. */
  noteId: z.string().optional(),
  conflict: z.boolean().optional(),
  /** Not applied: the server had newer data (still counts as done). */
  stale: z.boolean().optional(),
});
export const syncPushResult = z.object({ results: z.array(syncOpResult) });
export type SyncPushResult = z.infer<typeof syncPushResult>;
