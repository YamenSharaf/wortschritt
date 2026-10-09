import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AppTitle } from "../../components/AppTitle";
import { btn } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { onSignInEnded, startSignIn } from "../../lib/native/auth";
import { clearServer } from "../../lib/native/server";
import { hasNativeServer, nativeServerUrl } from "../../lib/platform";

/** The app's sign-in: the server's own sign-in page in a browser tab (OAuth). */
export function SignIn() {
  const navigate = useNavigate();
  const { authenticated } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSignInEnded(({ error }) => {
        setBusy(false);
        if (error) setError(error);
      }),
    [],
  );

  if (!hasNativeServer()) return <Navigate to="/connect" replace />;
  if (authenticated) return <Navigate to="/" replace />;

  async function signIn() {
    setError(null);
    setBusy(true);
    try {
      await startSignIn();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Couldn't start the sign-in.");
    }
  }

  async function changeServer() {
    await clearServer();
    navigate("/connect", { replace: true });
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-bold">
          <AppTitle />
        </h1>
        <p className="mb-6 break-all text-sm text-ink-muted">{nativeServerUrl()}</p>
        {error && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="button" disabled={busy} onClick={() => void signIn()} className={`${btn.primary} w-full`}>
          {busy ? "Waiting for sign-in…" : "Sign in"}
        </button>
        <p className="mt-2 text-center text-xs text-ink-muted">Opens your server's sign-in page.</p>
        <button
          type="button"
          onClick={() => void changeServer()}
          className="mt-3 min-h-11 w-full text-center text-sm text-ink-muted hover:text-ink"
        >
          Use a different server
        </button>
      </div>
    </div>
  );
}
