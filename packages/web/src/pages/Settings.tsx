import { useEffect, useReducer, useState } from "react";
import {
  generateCounts,
  MIN_PASSWORD_LENGTH,
  type ApiTokenView,
  type OAuthGrantView,
  type Settings,
} from "@mdb/shared";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/time";
import { useAsync } from "../lib/useAsync";
import {
  deviceVoices,
  getDeviceVoicePref,
  onVoicesChanged,
  setDeviceVoicePref,
  setServerTts,
  speak,
} from "../lib/tts";
import { ImportPage } from "./Import";
import { TabPills } from "../components/TabPills";
import { AiSettings } from "./AiSettings";
import { UsersAdmin } from "./UsersAdmin";

export function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"preferences" | "account" | "ai" | "users" | "import">(
    "preferences",
  );
  const tabs = [
    { value: "preferences", label: "Preferences" },
    { value: "account", label: "Account" },
    { value: "ai", label: "AI tutor" },
    ...(user?.role === "admin" ? [{ value: "users", label: "Users" } as const] : []),
    { value: "import", label: "Import content" },
  ] as const;
  return (
    <div>
      <h1 className="mb-4 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">Settings</h1>
      <div className="-mx-1 mb-6 overflow-x-auto px-1 pb-1">
        <TabPills label="Settings sections" value={tab} onChange={setTab} options={tabs} />
      </div>
      {tab === "preferences" && <Preferences />}
      {tab === "account" && <Account />}
      {tab === "ai" && <AiSettings />}
      {tab === "users" && user?.role === "admin" && <UsersAdmin />}
      {tab === "import" && <ImportPage />}
    </div>
  );
}

function Preferences() {
  const loaded = useAsync(() => api.settings(), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded.status === "ready") setForm(loaded.data);
  }, [loaded.status]);

  if (!form) return <p className="text-slate-500">Loading…</p>;

  async function save() {
    if (!form) return;
    await api.saveSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="max-w-md">
      <div className="space-y-4">
        <Field label="Display name">
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Level (CEFR)">
          <select
            value={form.level}
            onChange={(e) =>
              setForm({ ...form, level: e.target.value as Settings["level"] })
            }
            className="input"
          >
            {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Daily goal (tasks)">
          <input
            type="number"
            min={1}
            max={500}
            value={form.dailyGoal}
            onChange={(e) =>
              setForm({ ...form, dailyGoal: Number(e.target.value) })
            }
            className="input"
          />
        </Field>
        <Field label="Exercises to generate per batch">
          <select
            value={form.generateCount}
            onChange={(e) =>
              setForm({ ...form, generateCount: Number(e.target.value) })
            }
            className="input"
          >
            {generateCounts.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <p className="-mt-2 text-xs text-slate-400">
          The default count for “Generate more” after finishing an exercise. You
          can still change it there each time.
        </p>
        <PronunciationSetting
          value={form.ttsVoice}
          onChange={(v) => {
            setForm({ ...form, ttsVoice: v });
          }}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.llmGrading}
            onChange={(e) => setForm({ ...form, llmGrading: e.target.checked })}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium">
            Let the AI tutor grade written answers
          </span>
        </label>
        <p className="-mt-2 text-xs text-slate-400">
          Only used when your AI tutor is set up (the AI tutor tab). Falls back to exact matching
          otherwise.
        </p>
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground"
        >
          Save
        </button>
        {saved && <span className="ml-3 text-sm text-green-600">Saved ✓</span>}
      </div>
    </div>
  );
}

const PROVIDER_LABEL = {
  azure: "Natural voices (Azure)",
  edge: "Natural voices (Edge, unofficial)",
} as const;

/** Choose the voice: the device's own, or a server voice (Azure or Edge). */
function PronunciationSetting({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const status = useAsync(() => api.ttsStatus(), []);
  const [installed, setInstalled] = useState<string[]>([]);

  useEffect(() => {
    if (status.status === "ready") setInstalled(status.data.installed);
  }, [status.status]);

  const available = status.status === "ready" && status.data.available;

  function select(v: string) {
    onChange(v);
    setServerTts({ enabled: available && installed.includes(v), voice: v });
  }

  return (
    <Field label="Pronunciation voice">
      <select
        value={value}
        onChange={(e) => select(e.target.value)}
        className="input"
      >
        <option value="">Device voice (this browser)</option>
        {available &&
          (["azure", "edge"] as const).map((provider) => {
            const list = (status.status === "ready" ? status.data.voices : []).filter(
              (v) => v.provider === provider && installed.includes(v.id),
            );
            if (!list.length) return null;
            return (
              <optgroup key={provider} label={PROVIDER_LABEL[provider]}>
                {list.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label.replace(/ · (Azure|Edge)$/, "")}
                  </option>
                ))}
              </optgroup>
            );
          })}
        {value && !installed.includes(value) && <option value={value}>{value} (not available now)</option>}
      </select>

      {value === "" && <DeviceVoicePicker />}

      <div className="mt-2 space-y-2">
        <button
          type="button"
          onClick={() => speak("Guten Tag! Ich lerne Deutsch mit dem Baby.")}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-500 dark:border-slate-700"
        >
          🔊 Test
        </button>
        {!available && (
          <p className="text-xs text-slate-400">
            Natural German voices can be set up by the admin (Settings → Users → Read-aloud
            voices).
          </p>
        )}
        </div>
    </Field>
  );
}

/** Per-device (localStorage) choice of a specific browser voice. */
function DeviceVoicePicker() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [pref, setPref] = useState(getDeviceVoicePref());
  useEffect(() => onVoicesChanged(() => force()), []);

  const list = deviceVoices();
  if (list.length === 0) return null;
  const de = list.filter((v) => v.lang?.toLowerCase().startsWith("de"));
  const other = list.filter((v) => !v.lang?.toLowerCase().startsWith("de"));

  return (
    <div className="mt-2">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        Voice on this device
      </span>
      <select
        value={pref}
        onChange={(e) => {
          setDeviceVoicePref(e.target.value);
          setPref(e.target.value);
        }}
        className="input"
      >
        <option value="">Auto (best German)</option>
        {[...de, ...other].map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name}
            {v.lang ? ` — ${v.lang}` : ""}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-400">
        Remembered on this device only.
      </p>
    </div>
  );
}

function Account() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setMessage({ ok: false, text: "The new passwords don't match." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({ ok: true, text: "Password changed. Your other devices were signed out." });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : "Couldn't change the password.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <p className="text-sm text-slate-500">
        Signed in as <span className="font-medium text-slate-800 dark:text-slate-100">{user?.username}</span>
        {user?.role === "admin" && " (admin)"}
      </p>
      <form onSubmit={changePassword} className="space-y-4">
        <h2 className="text-lg font-semibold">Change password</h2>
        <Field label="Current password">
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="input"
          />
        </Field>
        <Field label={`New password (at least ${MIN_PASSWORD_LENGTH} characters)`}>
          <input
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="input"
          />
        </Field>
        <button
          type="submit"
          disabled={busy || !current || next.length < MIN_PASSWORD_LENGTH}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground disabled:opacity-50"
        >
          {busy ? "…" : "Change password"}
        </button>
        {message && (
          <p className={`text-sm ${message.ok ? "text-green-600" : "text-red-600"}`}>{message.text}</p>
        )}
      </form>
      <ConnectedApps />
      <ApiTokens />
    </div>
  );
}

/** Apps signed in via OAuth (MCP connectors). */
function ConnectedApps() {
  const [grants, setGrants] = useState<OAuthGrantView[] | null>(null);

  useEffect(() => {
    api.oauthGrants().then(setGrants).catch(() => setGrants([]));
  }, []);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Connected apps</h2>
      <p className="text-sm text-slate-500">
        To connect an AI agent like Claude, add a custom connector with the URL{" "}
        <code className="break-all">{`${window.location.origin}/mcp`}</code>. It will ask you to
        sign in here and allow access.
      </p>
      {grants && grants.length === 0 && <p className="text-sm text-slate-400">No apps connected.</p>}
      {grants && grants.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
          {grants.map((g) => (
            <li key={g.id} className="flex items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{g.clientName}</p>
                <p className="text-xs text-slate-400">
                  connected {timeAgo(g.createdAt)} ·{" "}
                  {g.lastUsedAt ? `last used ${timeAgo(g.lastUsedAt)}` : "never used"}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-red-600 dark:border-slate-700"
                onClick={async () => {
                  if (window.confirm(`Disconnect "${g.clientName}"? It loses access right away.`)) {
                    setGrants(await api.deleteOAuthGrant(g.id));
                  }
                }}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Personal API tokens for scripts and integrations (e.g. an MCP server). */
function ApiTokens() {
  const [tokens, setTokens] = useState<ApiTokenView[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.apiTokens().then(setTokens).catch(() => setError("Couldn't load tokens."));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.createApiToken(name.trim());
      setTokens(res.tokens);
      setCreated(res.token);
      setCopied(false);
      setName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the token.");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">API tokens</h2>
      <p className="text-sm text-slate-500">
        For scripts and integrations: send <code>Authorization: Bearer &lt;token&gt;</code>. A
        token can do everything you can, except manage tokens or change your password. API docs:{" "}
        <a href="/api/docs" className="underline" target="_blank" rel="noreferrer">
          /api/docs
        </a>
        .
      </p>
      <p className="text-sm text-slate-500">
        MCP connectors that take a header instead of signing in: URL{" "}
        <code className="break-all">{`${window.location.origin}/mcp`}</code> with{" "}
        <code>Authorization: Bearer &lt;token&gt;</code>.
      </p>
      {created && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950">
          <p className="mb-2 font-medium">Copy it now — it won't be shown again:</p>
          <code className="block break-all rounded bg-white p-2 text-xs dark:bg-slate-900">{created}</code>
          <button
            type="button"
            className="mt-2 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium dark:border-slate-700"
            onClick={() => {
              void navigator.clipboard.writeText(created);
              setCopied(true);
            }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      )}
      {tokens && tokens.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-slate-400">
                  {t.prefix}… · {t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : "never used"}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-red-600 dark:border-slate-700"
                onClick={async () => {
                  if (window.confirm(`Revoke "${t.name}"? Anything using it stops working.`)) {
                    setTokens(await api.deleteApiToken(t.id));
                  }
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name, e.g. MCP server"
          className="input"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          Create token
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
