import type {
  AdminUser,
  AiSettingsView,
  AuthUserDto,
  Cheatsheet,
  DictEntry,
  ExerciseItem,
  ExerciseProgress,
  ExerciseRun,
  ExerciseSet,
  ImportBody,
  Note,
  ProgressSummary,
  RecordRunBody,
  SaveNoteBody,
  RunSummary,
  SaveExerciseProgressBody,
  SaveVocabBody,
  Settings,
  SheetView,
  TtsStatus,
  VocabEntry,
  VocabFormsInput,
  VocabGroup,
  VocabStat,
  RegistrationStatus,
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

  // AI tutor settings (per user; the key is write-only)
  aiSettings: () => req<AiSettingsView>("/api/assistant/settings"),
  saveAiSettings: (body: { baseUrl: string; model: string; apiKey?: string | null }) =>
    req<AiSettingsView>("/api/assistant/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteAiSettings: () =>
    req<AiSettingsView>("/api/assistant/settings", { method: "DELETE" }),
  testAi: () => req<{ ok: true; reply: string }>("/api/assistant/test", { method: "POST" }),

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
  recordAttempt: (setId: string, itemId: string, correct: boolean) =>
    req<{ ok: true }>("/api/attempts", {
      method: "POST",
      body: JSON.stringify({ setId, itemId, correct }),
    }),

  // activity (per-run history + sheet views)
  runs: (limit?: number) =>
    req<RunSummary[]>(`/api/runs${limit ? `?limit=${limit}` : ""}`),
  run: (setId: string) => req<ExerciseRun | null>(`/api/runs/${setId}`),
  recordRun: (body: RecordRunBody) =>
    req<{ ok: true }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
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
  saveSettings: (s: Settings) =>
    req<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),

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
  ttsDownload: (voice: string) =>
    req<{ ok: true; installed: string[] }>("/api/tts/download", {
      method: "POST",
      body: JSON.stringify({ voice }),
    }),

  // assistant
  assistantStatus: () =>
    req<{ enabled: boolean; model: string }>("/api/assistant/status"),
  gradeAnswer: (body: {
    prompt?: string;
    expected: string[];
    response: string;
    context?: string;
  }) =>
    req<{ correct: boolean; feedback: string }>("/api/assistant/grade", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  generateMore: (body: {
    count?: number;
    set: {
      title: string;
      level: string;
      tags: string[];
      types: string[];
      samples: ExerciseItem[];
    };
  }) =>
    req<{ items: ExerciseItem[]; received: number }>("/api/assistant/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
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

export async function askAssistant(
  body: AskBody,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/assistant/ask", {
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
      let parsed: { token?: string; error?: string };
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.token) onToken(parsed.token);
    }
  }
}
