import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AppTitle } from "../../components/AppTitle";
import { btn } from "../../components/ui";
import { checkServer, saveServer } from "../../lib/native/server";
import { hasNativeServer } from "../../lib/platform";

const inputClass =
  "w-full rounded-control border border-line-control bg-transparent px-3 py-2 outline-none focus:border-focus aria-[invalid=true]:border-danger";

/** First launch of the app: which Wortschritt server to use. */
export function Connect() {
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [allowLanHttp, setAllowLanHttp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (hasNativeServer()) return <Navigate to="/login" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const check = await checkServer(address, allowLanHttp);
      if (!check.ok) {
        setError(check.error);
        return;
      }
      await saveServer(check.config);
      navigate("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-bold">
          <AppTitle />
        </h1>
        <p className="mb-6 text-sm text-ink-muted">Connect to your server</p>
        <label htmlFor="server" className="mb-1 block text-sm font-medium">
          Server address
        </label>
        <input
          id="server"
          type="url"
          inputMode="url"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://wortschritt.example.com"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby="server-hint"
          className={inputClass}
        />
        <p id="server-hint" className={`mb-4 mt-1 text-sm ${error ? "text-danger" : "text-ink-muted"}`}>
          {error ?? "The address you open Wortschritt at in the browser."}
        </p>
        <label className="mb-5 flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            checked={allowLanHttp}
            onChange={(e) => setAllowLanHttp(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="text-sm font-medium">Allow http on my network</span>
            <span className="block text-xs text-ink-muted">
              For a server at home without https, like http://192.168.1.20:3000. Others on that network could read
              what the app sends.
            </span>
          </span>
        </label>
        <button type="submit" disabled={busy} className={`${btn.primary} w-full`}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
