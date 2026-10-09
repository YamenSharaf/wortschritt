import { Navigate, useNavigate } from "react-router-dom";
import { AppTitle } from "../../components/AppTitle";
import { btn } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { clearServer } from "../../lib/native/server";
import { hasNativeServer, nativeServerUrl } from "../../lib/platform";

/** The app's sign-in: the server's own sign-in page in a browser tab (OAuth). */
export function SignIn() {
  const navigate = useNavigate();
  const { authenticated } = useAuth();

  if (!hasNativeServer()) return <Navigate to="/connect" replace />;
  if (authenticated) return <Navigate to="/" replace />;

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
        {/* Wired to OAuth (Custom Tab + PKCE) in the next step. */}
        <button type="button" disabled className={`${btn.primary} w-full`}>
          Sign in
        </button>
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
