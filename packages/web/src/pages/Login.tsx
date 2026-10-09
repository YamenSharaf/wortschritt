import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { MIN_PASSWORD_LENGTH } from "@mdb/shared";
import { api, ApiError } from "../lib/api";
import { useAuth } from "@mdb/client/react";
import { AppTitle } from "../components/AppTitle";
import { btn } from "../components/ui";

const inputClass =
  "mb-4 w-full rounded-control border border-line-control bg-transparent px-3 py-2 outline-none focus:border-focus ";

export function Login() {
  const { login, register, authenticated } = useAuth();
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
        className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-sm "
      >
        <h1 className="mb-1 text-xl font-bold">
          <AppTitle />
        </h1>
        <p className="mb-6 text-sm text-ink-muted">
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
            <span className="font-normal text-ink-subtle">
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
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className={`${btn.primary} w-full`}
        >
          {busy ? "…" : registering ? "Create account" : "Sign in"}
        </button>
        {(canRegister || registering) && (
          <button
            type="button"
            onClick={switchMode}
            className="mt-3 w-full text-center text-sm text-ink-muted hover:text-ink "
          >
            {registering ? "I already have an account" : "New here? Create an account"}
          </button>
        )}
      </form>
    </div>
  );
}
