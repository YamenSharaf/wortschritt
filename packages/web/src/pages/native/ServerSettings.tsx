import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { btn } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { clearServer } from "../../lib/native/server";
import { nativeServerUrl } from "../../lib/platform";

/** Settings → Account in the app: which server it uses, and switching to another. */
export function ServerSettings() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);

  async function change() {
    const ok = window.confirm(
      "Use a different server? You'll be signed out, and what this app keeps from this server is removed from the device.",
    );
    if (!ok) return;
    setBusy(true);
    await logout();
    await clearServer();
    navigate("/connect", { replace: true });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-[-0.01em]">Server</h2>
      <p className="break-all text-sm text-ink-muted">{nativeServerUrl()}</p>
      <button type="button" disabled={busy} onClick={() => void change()} className={btn.secondary}>
        Change server
      </button>
    </section>
  );
}
