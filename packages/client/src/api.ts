import type {
  AdminUser,
  TtsAdminSettings,
  AnswerBody,
  AnswerVerdict,
  GenerateMoreResult,
  ApiTokenView,
  ImportedItem,
  OAuthGrantView,
  OAuthRequestView,
  AiModelOption,
  AiSettingsView,
  AiTestResult,
  AuthUserDto,
  Cheatsheet,
  DictEntry,
  ExerciseItem,
  ExerciseProgress,
  ExerciseRun,
  ExerciseSet,
  Favorite,
  FavoriteKind,
  GenerateStoryBody,
  ImportBody,
  Note,
  NoteAttachment,
  ProgressSummary,
  SaveNoteBody,
  RunSummary,
  SaveExerciseProgressBody,
  SaveVocabBody,
  Settings,
  SeriesSummary,
  SeriesView,
  SheetView,
  Story,
  StoryAudio,
  StoryContext,
  StoryContextOptions,
  StoryTranslations,
  StorySummary,
  StoryView,
  SyncChanges,
  SyncOp,
  SyncPushResult,
  TtsStatus,
  VocabEntry,
  VocabFormsInput,
  VocabGroup,
  VocabStat,
  RegistrationStatus,
  WordDetails,
  WordLookup,
  GermanWord,
} from "@mdb/shared";

import { createHttp, type ClientOptions } from "./http";
import { readSse, type SseEvent } from "./sse";

/** Pull the grammatical forms out of an AI word lookup for persisting. */
export function formsFromLookup(d: WordLookup): VocabFormsInput | undefined {
  const f: VocabFormsInput = {};
  if (d.pos) f.pos = d.pos;
  if (d.partizip2) f.partizip2 = d.partizip2;
  if (d.auxiliary) f.auxiliary = d.auxiliary;
  if (d.article) f.article = d.article;
  if (d.plural) f.plural = d.plural;
  return Object.keys(f).length ? f : undefined;
}

/** A tutor chat turn, and what a tutor request can ask for. */
export type ChatTurn = { role: "user" | "assistant"; content: string };
export type AskBody = {
  task?:
    | "highlight"
    | "hint"
    | "why_wrong"
    | "translate_exercise"
    | "translate_sheet"
    | "chat";
  selection?: string;
  question?: string;
  context?: string;
  item?: { type: string; label: string; expected: string[] };
  response?: string;
  text?: string;
  history?: ChatTurn[];
};

export type StoryGenerationEvent =
  | { phase: "writing"; chars: number }
  | { phase: "checking" }
  | { phase: "fixing"; problems: number };

export type Api = ReturnType<typeof createApi>;

/**
 * Every server endpoint, for one server and one way of signing in: the web
 * uses its session cookie on the same origin, the app a bearer token.
 */
export function createApi(o: ClientOptions) {
  const { req, stream, url } = createHttp(o);

  /**
   * POST a JSON body to a Server-Sent Events endpoint and hand each `data:`
   * object to `onEvent` until `[DONE]`. Non-2xx answers throw an ApiError; an
   * `{error}` event throws an Error with its message.
   */
  async function postSse(path: string, body: unknown, onEvent: (data: SseEvent) => void, signal?: unknown) {
    const res = await stream(path, { method: "POST", body: JSON.stringify(body), signal });
    await readSse(res.body!.getReader(), onEvent);
  }

  return {
    // auth
    me: () =>
      req<{ authenticated: boolean; user: AuthUserDto | null }>("/api/auth/me"),
    login: (username: string, password: string) =>
      req<{ ok: true }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    registration: () => req<RegistrationStatus>("/api/auth/registration"),
    register: (username: string, password: string) =>
      req<{ ok: true }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    changePassword: (currentPassword: string, newPassword: string) =>
      req<{ ok: true }>("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      }),

    // AI tutor settings (per user; keys are write-only)
    aiSettings: () => req<AiSettingsView>("/api/assistant/settings"),
    addAiProvider: (body: { name: string; baseUrl: string; apiKey?: string | null }) =>
      req<AiSettingsView>("/api/assistant/providers", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateAiProvider: (
      id: number,
      body: { name: string; baseUrl: string; apiKey?: string | null },
    ) =>
      req<AiSettingsView>(`/api/assistant/providers/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    deleteAiProvider: (id: number) =>
      req<AiSettingsView>(`/api/assistant/providers/${id}`, { method: "DELETE" }),
    aiProviderModels: (id: number) =>
      req<AiModelOption[]>(`/api/assistant/providers/${id}/models`),
    saveAiModels: (models: { providerId: number; model: string }[]) =>
      req<AiSettingsView>("/api/assistant/models", {
        method: "PUT",
        body: JSON.stringify({ models }),
      }),
    deleteAiSettings: () =>
      req<AiSettingsView>("/api/assistant/settings", { method: "DELETE" }),
    testAi: () => req<AiTestResult>("/api/assistant/test", { method: "POST" }),

    // personal API tokens (from a signed-in session)
    apiTokens: () => req<ApiTokenView[]>("/api/auth/tokens"),
    createApiToken: (name: string) =>
      req<{ token: string; tokens: ApiTokenView[] }>("/api/auth/tokens", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    deleteApiToken: (id: number) =>
      req<ApiTokenView[]>(`/api/auth/tokens/${id}`, { method: "DELETE" }),

    // OAuth: the consent screen and connected apps
    oauthRequest: (query: string) =>
      req<OAuthRequestView | { redirect: string }>(`/api/oauth/authorize${query}`),
    oauthDecide: (params: Record<string, string>, approve: boolean) =>
      req<{ redirect: string }>("/api/oauth/authorize", {
        method: "POST",
        body: JSON.stringify({ params, approve }),
      }),
    oauthGrants: () => req<OAuthGrantView[]>("/api/oauth/grants"),
    deleteOAuthGrant: (id: number) =>
      req<OAuthGrantView[]>(`/api/oauth/grants/${id}`, { method: "DELETE" }),

    // admin: server time zone
    timezone: () => req<{ timezone: string }>("/api/admin/timezone"),
    setTimezone: (timezone: string) =>
      req<{ timezone: string }>("/api/admin/timezone", {
        method: "PUT",
        body: JSON.stringify({ timezone }),
      }),

    // stories (private reading texts)
    stories: () => req<StorySummary[]>("/api/stories"),
    story: (id: string) => req<StoryView>(`/api/stories/${encodeURIComponent(id)}`),
    createStory: (story: Story) =>
      req<StoryView>("/api/stories", { method: "POST", body: JSON.stringify({ story }) }),
    updateStory: (story: Story) =>
      req<StoryView>(`/api/stories/${encodeURIComponent(story.id)}`, {
        method: "PUT",
        body: JSON.stringify(story),
      }),
    deleteStory: (id: string) =>
      req<{ ok: true }>(`/api/stories/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** How far you've read; the server keeps the further position. */
    storyProgress: (id: string, progress: number) =>
      req<{ ok: true }>(`/api/stories/${encodeURIComponent(id)}/progress`, {
        method: "PUT",
        body: JSON.stringify({ progress }),
      }),
    markStoryRead: (id: string) =>
      req<{ ok: true }>(`/api/stories/${encodeURIComponent(id)}/read`, { method: "POST" }),
    /** "Read again": unread, back to the start. */
    readStoryAgain: (id: string) =>
      req<{ ok: true }>(`/api/stories/${encodeURIComponent(id)}/read`, { method: "DELETE" }),
    wordDetails: (word: string) =>
      req<WordDetails | null>(`/api/dict/${encodeURIComponent(word)}/details`),
    seriesList: () => req<SeriesSummary[]>("/api/series"),
    series: (id: string) => req<SeriesView>(`/api/series/${encodeURIComponent(id)}`),
    setCover: (kind: "story" | "series", id: string, svg: string | null) =>
      req<{ cover: string | null }>(`/api/${kind === "series" ? "series" : "stories"}/${encodeURIComponent(id)}/cover`, {
        method: "PUT",
        body: JSON.stringify({ svg }),
      }),
    deleteSeries: (id: string) =>
      req<{ ok: true }>(`/api/series/${encodeURIComponent(id)}`, { method: "DELETE" }),
    storyTranslations: (id: string) =>
      req<StoryTranslations>(`/api/stories/${encodeURIComponent(id)}/translations`),
    translateStory: (id: string, paragraphs: number[]) =>
      req<StoryTranslations>(`/api/stories/${encodeURIComponent(id)}/translations`, {
        method: "POST",
        body: JSON.stringify({ paragraphs }),
      }),
    storyContext: (o: StoryContextOptions) =>
      req<StoryContext>(
        `/api/story-context?mistakes=${o.mistakes}&vocab=${o.vocab}&topics=${o.topics}`,
      ),
    lemmas: (words: string[]) =>
      req<Record<string, string>>("/api/dict/lemmas", {
        method: "POST",
        body: JSON.stringify({ words }),
      }),

    // imported (shared-library) content
    imports: () => req<ImportedItem[]>("/api/imports"),
    deleteImport: (id: string) =>
      req<{ ok: true }>(`/api/imports/${encodeURIComponent(id)}`, { method: "DELETE" }),

    // admin
    adminUsers: () => req<AdminUser[]>("/api/admin/users"),
    adminUpdateUser: (id: number, patch: { disabled?: boolean; role?: "admin" | "user" }) =>
      req<{ ok: true }>(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    adminSetPassword: (id: number, password: string) =>
      req<{ ok: true }>(`/api/admin/users/${id}/password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    adminDeleteUser: (id: number) =>
      req<{ ok: true }>(`/api/admin/users/${id}`, { method: "DELETE" }),
    adminRegistration: () => req<RegistrationStatus>("/api/admin/registration"),
    adminTts: () => req<TtsAdminSettings>("/api/admin/tts"),
    adminSetTts: (body: { azure?: { region: string; key?: string } | null; edge?: boolean }) =>
      req<TtsAdminSettings>("/api/admin/tts", { method: "PUT", body: JSON.stringify(body) }),
    adminTestTts: (voice: string) =>
      req<{ ok: true; bytes: number }>("/api/admin/tts/test", { method: "POST", body: JSON.stringify({ voice }) }),
    adminSetRegistration: (open: boolean) =>
      req<RegistrationStatus>("/api/admin/registration", {
        method: "PUT",
        body: JSON.stringify({ open }),
      }),

    // content
    exercises: () => req<ExerciseSet[]>("/api/exercises"),
    exercise: (id: string) => req<ExerciseSet>(`/api/exercises/${id}`),
    cheatsheets: () => req<Cheatsheet[]>("/api/cheatsheets"),
    cheatsheet: (id: string) => req<Cheatsheet>(`/api/cheatsheets/${id}`),

    // progress
    progress: () => req<ProgressSummary>("/api/progress"),
    /** The server grades the answer, records it and returns the verdict. */
    answer: (body: AnswerBody) =>
      req<AnswerVerdict>("/api/answers", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    // activity (per-run history + sheet views)
    runs: (limit?: number) =>
      req<RunSummary[]>(`/api/runs${limit ? `?limit=${limit}` : ""}`),
    run: (setId: string) => req<ExerciseRun | null>(`/api/runs/${setId}`),
    /** End a pass through a set; the server scores it from its session. */
    finishRun: (setId: string, done: boolean) =>
      req<{ ok: true }>("/api/runs", {
        method: "POST",
        body: JSON.stringify({ setId, done }),
      }),
    exerciseProgress: (setId: string) =>
      req<ExerciseProgress | null>(
        `/api/exercise-progress/${encodeURIComponent(setId)}`,
      ),
    saveExerciseProgress: (setId: string, body: SaveExerciseProgressBody) =>
      req<{ ok: true }>(`/api/exercise-progress/${encodeURIComponent(setId)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    clearExerciseProgress: (setId: string) =>
      req<{ ok: true }>(`/api/exercise-progress/${encodeURIComponent(setId)}`, {
        method: "DELETE",
      }),
    sheetViews: (limit?: number) =>
      req<SheetView[]>(`/api/sheet-views${limit ? `?limit=${limit}` : ""}`),
    recordSheetView: (sheetId: string, title: string) =>
      req<{ ok: true }>("/api/sheet-views", {
        method: "POST",
        body: JSON.stringify({ sheetId, title }),
      }),

    // settings
    settings: () => req<Settings>("/api/settings"),
    /** `keepalive` lets the save finish while the page is closing. */
    saveSettings: (s: Settings, opts: { keepalive?: boolean } = {}) =>
      req<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s), keepalive: opts.keepalive }),

    // favourites (starred sets and sheets), newest first
    favorites: () => req<Favorite[]>("/api/favorites"),
    /** Star or unstar; resolves to the whole list after the change. */
    setFavorite: (kind: FavoriteKind, id: string, on: boolean) =>
      req<Favorite[]>(`/api/favorites/${kind}/${encodeURIComponent(id)}`, { method: on ? "PUT" : "DELETE" }),

    // import
    import: (body: ImportBody) =>
      req<{ ok: true; id: string; kind: string }>("/api/import", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    // offline dictionary (instant gloss on tap)
    dictStatus: () => req<{ available: boolean }>("/api/dict/status"),
    dict: (word: string) =>
      req<DictEntry | null>(`/api/dict/${encodeURIComponent(word)}`),

    // notes
    notes: () => req<Note[]>("/api/notes"),
    note: (id: string) => req<Note | null>(`/api/notes/${encodeURIComponent(id)}`),
    createNote: (body?: Partial<SaveNoteBody>) =>
      req<Note>("/api/notes", {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      }),
    saveNote: (id: string, body: SaveNoteBody) =>
      req<Note>(`/api/notes/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    removeNote: (id: string) =>
      req<{ ok: true }>(`/api/notes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    /** Keep a file with a note: `body` is the file itself (a File or Blob on the web). */
    uploadAttachment: (noteId: string, file: { name: string; type: string; body: object }) =>
      req<NoteAttachment>(`/api/notes/${encodeURIComponent(noteId)}/attachments?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file.body,
      }),
    removeAttachment: (id: string) =>
      req<{ ok: true }>(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** Where an attachment's file is (`download` asks the browser to save it). */
    attachmentUrl: (id: string, download = false) =>
      url(`/api/attachments/${encodeURIComponent(id)}${download ? "?download=1" : ""}`),
    cleanupNotes: (text: string) =>
      req<{ text: string }>("/api/assistant/cleanup-notes", {
        method: "POST",
        body: JSON.stringify({ text }),
      }),

    // vocab
    vocab: () => req<VocabEntry[]>("/api/vocab"),
    vocabGet: (word: string) =>
      req<VocabEntry | null>(`/api/vocab/${encodeURIComponent(word)}`),
    vocabSave: (body: SaveVocabBody) =>
      req<VocabEntry>("/api/vocab", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    vocabRemove: (word: string) =>
      req<{ ok: true }>(`/api/vocab/${encodeURIComponent(word)}`, {
        method: "DELETE",
      }),
    studyVocab: (word: string, known: boolean) =>
      req<VocabStat>(`/api/vocab/${encodeURIComponent(word)}/study`, {
        method: "POST",
        body: JSON.stringify({ known }),
      }),
    resetVocabStudy: (word: string) =>
      req<{ ok: true }>(`/api/vocab/${encodeURIComponent(word)}/study`, {
        method: "DELETE",
      }),
    translateWord: (
      word: string,
      opts?: { context?: string; meaning?: string; count?: number },
    ) =>
      req<WordLookup>("/api/assistant/word", {
        method: "POST",
        body: JSON.stringify({ word, ...opts }),
      }),
    /** English → German from the curated glosses (translation exercises). */
    germanFromGlossary: (word: string) => req<GermanWord[]>(`/api/dict/en/${encodeURIComponent(word)}`),
    /** English → German by the tutor, in the sense the sentence uses. */
    germanWord: (word: string, context?: string) =>
      req<GermanWord>("/api/assistant/german-word", {
        method: "POST",
        body: JSON.stringify({ word, ...(context ? { context } : {}) }),
      }),

    // vocab groups
    vocabGroups: () => req<VocabGroup[]>("/api/vocab-groups"),
    vocabGroupCreate: (name: string) =>
      req<VocabGroup>("/api/vocab-groups", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    vocabGroupDelete: (id: number) =>
      req<{ ok: true }>(`/api/vocab-groups/${id}`, { method: "DELETE" }),
    vocabGroupAddWord: (id: number, word: string) =>
      req<{ ok: true }>(`/api/vocab-groups/${id}/words`, {
        method: "POST",
        body: JSON.stringify({ word }),
      }),
    vocabGroupRemoveWord: (id: number, word: string) =>
      req<{ ok: true }>(
        `/api/vocab-groups/${id}/words/${encodeURIComponent(word)}`,
        { method: "DELETE" },
      ),

    // tts (pronunciation)
    ttsStatus: () => req<TtsStatus>("/api/tts/status"),

    // assistant
    assistantStatus: () =>
      req<{ enabled: boolean; model: string }>("/api/assistant/status"),
    /** The server writes more items for the set and keeps them for this learner. */
    generateMore: (setId: string, count: number) =>
      req<GenerateMoreResult>(`/api/exercises/${encodeURIComponent(setId)}/generate`, {
        method: "POST",
        body: JSON.stringify({ count }),
      }),
    /** How many items were generated for this learner, by set id (sets without any are left out). */
    generatedCounts: () => req<Record<string, number>>("/api/exercises/generated-counts"),
    generatedItems: (setId: string) =>
      req<ExerciseItem[]>(`/api/exercises/${encodeURIComponent(setId)}/generated`),
    removeGeneratedItems: (setId: string) =>
      req<{ removed: number }>(`/api/exercises/${encodeURIComponent(setId)}/generated`, { method: "DELETE" }),
    removeGeneratedItem: (setId: string, itemId: string) =>
      req<{ removed: number }>(`/api/exercises/${encodeURIComponent(setId)}/generated/${encodeURIComponent(itemId)}`, { method: "DELETE" }),

    // offline sync (the app): what changed since a cursor, and replaying queued actions
    syncChanges: (o: { since?: string; library?: string } = {}) => {
      const q = [o.since && `since=${encodeURIComponent(o.since)}`, o.library && `library=${encodeURIComponent(o.library)}`]
        .filter(Boolean)
        .join("&");
      return req<SyncChanges>(`/api/sync/changes${q ? `?${q}` : ""}`);
    },
    syncPush: (ops: SyncOp[]) =>
      req<SyncPushResult>("/api/sync/push", { method: "POST", body: JSON.stringify({ ops }) }),

    // media: where to load covers, clips and books from
    coverUrl: (kind: "story" | "series", id: string, version: string) =>
      url(`/api/${kind === "series" ? "series" : "stories"}/${id}/cover.svg?v=${encodeURIComponent(version)}`),
    /** The cover as a PNG about `width` pixels wide (for the app, which draws SVG poorly). */
    coverPngUrl: (kind: "story" | "series", id: string, version: string, width: number) =>
      url(`/api/${kind === "series" ? "series" : "stories"}/${id}/cover.png?w=${Math.round(width)}&v=${encodeURIComponent(version)}`),
    epubUrl: (kind: "story" | "series", id: string) =>
      url(`/api/${kind === "series" ? "series" : "stories"}/${id}/epub`),
    /** A story as one audio file: where it stands, making it (poll storyAudio after), and the file. */
    storyAudio: (id: string) => req<StoryAudio>(`/api/stories/${encodeURIComponent(id)}/audio`),
    startStoryAudio: (id: string) => req<StoryAudio>(`/api/stories/${encodeURIComponent(id)}/audio`, { method: "POST" }),
    storyAudioUrl: (id: string, key: string) => url(`/api/stories/${encodeURIComponent(id)}/audio/${key}.mp3`),
    ttsUrl: (voice: string, text: string) =>
      url(`/api/tts?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`),

    /** Stream a tutor answer, calling `onToken` for each text delta. */
    askAssistant: (body: AskBody, onToken: (token: string) => void, signal?: unknown): Promise<void> =>
      postSse("/api/assistant/ask", body, (e) => typeof e.token === "string" && onToken(e.token), signal),

    /** Write and save a story with the learner's AI; resolves with its id. */
    async generateStory(
      body: GenerateStoryBody,
      onProgress: (e: StoryGenerationEvent) => void,
      signal?: unknown,
    ): Promise<{ id: string; questionsDropped: boolean }> {
      let result: { id: string; questionsDropped: boolean } | null = null;
      await postSse(
        "/api/stories/generate",
        body,
        (e) => {
          if (e.done) result = e.done as { id: string; questionsDropped: boolean };
          else if (typeof e.phase === "string") onProgress(e as StoryGenerationEvent);
        },
        signal,
      );
      if (!result) throw new Error("The story generator stopped before finishing. Try again.");
      return result;
    },
  };
}
