import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useConfig } from "../lib/config";

export function Login() {
  const { login, authenticated } = useAuth();
  const { appName, appEmoji } = useConfig();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Once authenticated, redirect declaratively instead of navigating in render.
  if (authenticated) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      // The `authenticated` guard above handles the redirect on next render.
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "Too many attempts. Try again later."
          : "Incorrect username or password",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <h1 className="mb-1 text-xl font-bold">
          {appName} {appEmoji}
        </h1>
        <p className="mb-6 text-sm text-slate-500">Sign in</p>
        <label className="mb-1 block text-sm font-medium">Username</label>
        <input
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-accent dark:border-slate-700"
        />
        <label className="mb-1 block text-sm font-medium">Password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-accent dark:border-slate-700"
        />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground disabled:opacity-50"
        >
          {busy ? "…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
