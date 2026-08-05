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
};
