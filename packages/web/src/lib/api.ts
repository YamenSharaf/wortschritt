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
  GenerateStoryBody,
  ImportBody,
  Note,
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
  StoryContext,
  StoryContextOptions,
  StoryTranslations,
  StorySummary,
  StoryView,
  TtsStatus,
  VocabEntry,
  VocabFormsInput,
  VocabGroup,
  VocabStat,
  RegistrationStatus,
  WordDetails,
  WordLookup,
} from "@mdb/shared";

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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only advertise a JSON body when we actually send one — Fastify rejects an
  // empty body sent with content-type: application/json (e.g. DELETE requests).
  const headers: Record<string, string> = {
    ...(init?.body != null ? { "content-type": "application/json" } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(path, { credentials: "same-origin", ...init, headers });
  if (res.status === 401) throw new ApiError(401, "unauthenticated");
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const api = {
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
  generatedItems: (setId: string) =>
    req<ExerciseItem[]>(`/api/exercises/${encodeURIComponent(setId)}/generated`),
  removeGeneratedItems: (setId: string) =>
    req<{ removed: number }>(`/api/exercises/${encodeURIComponent(setId)}/generated`, { method: "DELETE" }),
};

/**
 * Stream a tutor answer. Reads the server's SSE response and calls `onToken`
 * for each text delta. Resolves when the stream ends; rejects on error.
 */
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

/**
 * POST a JSON body to a Server-Sent Events endpoint and hand each `data:`
 * object to `onEvent` until `[DONE]`. Non-2xx answers throw an ApiError; an
 * `{error}` event throws an Error with its message.
 */
async function postSse(
  url: string,
  body: unknown,
  onEvent: (data: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) throw new ApiError(401, "unauthenticated");
  if (!res.ok || !res.body) {
    let message = res.statusText;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim();
      if (data === "[DONE]") return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (typeof parsed.error === "string") throw new Error(parsed.error);
      onEvent(parsed);
    }
  }
}

export function askAssistant(
  body: AskBody,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  return postSse(
    "/api/assistant/ask",
    body,
    (e) => typeof e.token === "string" && onToken(e.token),
    signal,
  );
}

export type StoryGenerationEvent =
  | { phase: "writing"; chars: number }
  | { phase: "checking" }
  | { phase: "fixing"; problems: number };

/** Write and save a story with the learner's AI; resolves with its id. */
export async function generateStory(
  body: GenerateStoryBody,
  onProgress: (e: StoryGenerationEvent) => void,
  signal?: AbortSignal,
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
}
