import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { MIN_PASSWORD_LENGTH } from "@mdb/shared";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useConfig } from "../lib/config";

const inputClass =
  "mb-4 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-accent dark:border-slate-700";

export function Login() {
  const { login, register, authenticated } = useAuth();
  const { appName, appEmoji } = useConfig();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [canRegister, setCanRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Where to go after signing in (e.g. back to an OAuth consent screen).
  // Same-origin paths only, so the login page can't be used as a redirector.
  const next = useSearchParams()[0].get("next");
  const target = next && /^\/(?![/\\])/.test(next) ? next : "/";

  // Offer "Create account" only while the admin has registration open.
  useEffect(() => {
    api
      .registration()
      .then((r) => setCanRegister(r.open))
      .catch(() => setCanRegister(false));
  }, []);

  // Once authenticated, redirect declaratively instead of navigating in render.
  if (authenticated) {
    return <Navigate to={target} replace />;
  }

  const registering = mode === "register";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (registering && password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      if (registering) await register(username, password);
      else await login(username, password);
      // The `authenticated` guard above handles the redirect on next render.
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 429) setError("Too many attempts. Try again later.");
      else if (registering) {
        setError(err instanceof ApiError ? err.message : "Couldn't create the account.");
      } else setError("Incorrect username or password");
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(registering ? "login" : "register");
    setError(null);
    setPassword("");
    setConfirm("");
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
        <p className="mb-6 text-sm text-slate-500">
          {registering ? "Create an account" : "Sign in"}
        </p>
        <label className="mb-1 block text-sm font-medium">Username</label>
        <input
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClass}
        />
        <label className="mb-1 block text-sm font-medium">
          Password
          {registering && (
            <span className="font-normal text-slate-400">
              {" "}
              (at least {MIN_PASSWORD_LENGTH} characters)
            </span>
          )}
        </label>
        <input
          type="password"
          autoComplete={registering ? "new-password" : "current-password"}
          minLength={registering ? MIN_PASSWORD_LENGTH : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        {registering && (
          <>
            <label className="mb-1 block text-sm font-medium">Confirm password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </>
        )}
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground disabled:opacity-50"
        >
          {busy ? "…" : registering ? "Create account" : "Sign in"}
        </button>
        {(canRegister || registering) && (
          <button
            type="button"
            onClick={switchMode}
            className="mt-3 w-full text-center text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            {registering ? "I already have an account" : "New here? Create an account"}
          </button>
        )}
      </form>
    </div>
  );
}
