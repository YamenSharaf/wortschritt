import type {
  Cheatsheet,
  ExerciseSet,
  ImportBody,
  ProgressSummary,
  Settings,
} from "@mdb/shared";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
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
  me: () => req<{ authenticated: boolean }>("/api/auth/me"),
  login: (password: string) =>
    req<{ ok: true }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),

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

  // assistant
  assistantStatus: () =>
    req<{ enabled: boolean; model: string }>("/api/assistant/status"),
};

/**
 * Stream a tutor answer. Reads the server's SSE response and calls `onToken`
 * for each text delta. Resolves when the stream ends; rejects on error.
 */
export async function askAssistant(
  body: { selection: string; question?: string; context?: string },
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
