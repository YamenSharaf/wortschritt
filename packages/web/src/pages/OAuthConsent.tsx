import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { OAuthRequestView } from "@mdb/shared";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AppTitle } from "../components/AppTitle";
import { btn } from "../components/ui";

/**
 * The OAuth consent screen (`/oauth/authorize`): an MCP client such as Claude
 * sends the user here to sign in and allow access; Allow/Deny returns them to
 * the client.
 */
export function OAuthConsent() {
  const { authenticated, loading, logout } = useAuth();
  const location = useLocation();
  const [view, setView] = useState<OAuthRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    api
      .oauthRequest(location.search)
      .then((r) => {
        if ("redirect" in r) window.location.replace(r.redirect);
        else setView(r);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "This sign-in link doesn't work."));
  }, [authenticated, location.search]);

  if (loading) return <div className="grid min-h-screen place-items-center text-ink-muted">Loading…</div>;
  if (!authenticated) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const params = Object.fromEntries(new URLSearchParams(location.search));
      const { redirect } = await api.oauthDecide(params, approve);
      window.location.assign(redirect);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-sm ">
        <h1 className="mb-4 text-xl font-bold">
          <AppTitle />
        </h1>
        {error && (
          <>
            <p className="mb-2 font-medium">Can't connect this app</p>
            <p className="text-sm text-danger">{error}</p>
          </>
        )}
        {!error && !view && <p className="text-ink-muted">Loading…</p>}
        {!error && view && (
          <>
            <p className="mb-4">
              <strong>{view.client.name}</strong> wants to access your account{" "}
              <strong>{view.username}</strong>.
            </p>
            <p className="mb-2 text-sm text-ink-muted">It will be able to do everything you can:</p>
            <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-ink-muted">
              <li>read and change your vocabulary, notes and progress</li>
              <li>add exercises and cheat sheets, and edit or delete the ones you added</li>
            </ul>
            <p className="mb-6 text-sm text-ink-muted">
              You'll be sent back to <strong>{view.client.redirectHost}</strong>. Only allow apps you
              set up yourself. You can disconnect it any time in Settings.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(false)}
                className="flex-1 rounded-control border border-line-control px-4 py-2 font-medium disabled:opacity-50 "
              >
                Deny
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(true)}
                className={`${btn.primary} flex-1`}
              >
                Allow
              </button>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-3 w-full text-center text-sm text-ink-muted hover:text-ink "
            >
              Not {view.username}? Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
