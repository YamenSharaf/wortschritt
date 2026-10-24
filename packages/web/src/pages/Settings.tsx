import { useEffect, useReducer, useState } from "react";
import {
  generateCounts,
  MIN_PASSWORD_LENGTH,
  serverVoices,
  ttsProviderOf,
  type ApiTokenView,
  type OAuthGrantView,
  type Settings,
} from "@mdb/shared";
import { api, ApiError } from "../lib/api";
import { useAsync, useAuth, useAvatar } from "@mdb/client/react";
import { serverTtsFor, timeAgo } from "@mdb/client";
import { useAppearance } from "../lib/appearance";
import { useAutoAdvance } from "../lib/autoAdvance";
import { setListeningEnabled } from "../lib/listening";
import {
  deviceVoices,
  getDeviceVoicePref,
  onVoicesChanged,
  setDeviceVoicePref,
  setServerTts,
  speak,
  speech,
} from "../lib/tts";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { TabPills } from "../components/TabPills";
import { AiSettings } from "./AiSettings";
import { ShuffleIcon, SpeakerIcon } from "../components/icons";
import { Avatar } from "../components/Avatar";
import { btn } from "../components/ui";

const SETTINGS_TABS = [
  { value: "learning", label: "Learning" },
  { value: "account", label: "Account" },
  { value: "connections", label: "Connections" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["value"];

/** Personal settings, one route per tab (/settings/learning, …) so links and Back work. */
export function SettingsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const current = SETTINGS_TABS.find((t) => t.value === tab)?.value;
  if (!current) return <Navigate to="/settings/learning" replace />;
  return (
    <div>
      <h1 className="mb-4 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">Settings</h1>
      <div className="-mx-1 mb-6 overflow-x-auto px-1 pb-1">
        <TabPills
          label="Settings sections"
          value={current}
          onChange={(t) => navigate(`/settings/${t}`)}
          options={SETTINGS_TABS}
        />
      </div>
      {current === "learning" && (
        <>
          <Learning />
          <Appearance />
          <PracticeOnDevice />
        </>
      )}
      {current === "account" && <Account />}
      {current === "connections" && <Connections />}
      <div className="mt-10 space-y-2 text-sm text-ink-subtle">
        <p>
          About AI: the tutor's answers, AI translations, generated stories and “Generate more” questions are written by an AI model and can be
          wrong. Stories and sets may also have been written with AI.
        </p>
        <p>
          <Link to="/licenses" className="underline decoration-dotted hover:text-ink">
            Open-source licences
          </Link>
        </p>
      </div>
    </div>
  );
}

/** Things outside the app that act for you: the AI tutor's provider, connected agents, tokens. */
function Connections() {
  return (
    <div className="max-w-xl space-y-10">
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">AI tutor</h2>
        <AiSettings />
      </section>
      <ConnectedApps />
      <ApiTokens />
    </div>
  );
}

function Learning() {
  const loaded = useAsync(() => api.settings(), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded.status === "ready") setForm(loaded.data);
  }, [loaded.status]);

  if (!form) return <p className="text-ink-muted">Loading…</p>;

  async function save() {
    if (!form) return;
    await api.saveSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="max-w-md">
      <div className="space-y-4">
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
        <p className="-mt-2 text-xs text-ink-subtle">
          The default count for “Generate more” after finishing an exercise. You
          can still change it there each time.
        </p>
        <VoiceSettings
          ttsVoice={form.ttsVoice}
          readerVoice={form.readerVoice}
          onChange={(change) => setForm({ ...form, ...change })}
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
        <p className="-mt-2 text-xs text-ink-subtle">
          Only used when your AI tutor is set up (Settings → Connections). Falls back to exact matching
          otherwise.
        </p>
        <button
          type="button"
          onClick={save}
          className={`${btn.primary}`}
        >
          Save
        </button>
        {saved && <span className="ml-3 text-sm text-success">Saved</span>}
      </div>
    </div>
  );
}

/** How the app looks on this device; not synced, since a phone and an e-reader differ. */
function Appearance() {
  const look = useAppearance();
  return (
    <section className="mt-10 max-w-md">
      <h2 className="text-xl font-semibold tracking-[-0.01em]">Appearance</h2>
      <p className="mb-4 mt-1 text-sm text-ink-muted">On this device only.</p>
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium">Theme</span>
          <TabPills
            size="sm"
            label="Theme"
            value={look.scheme}
            onChange={look.setScheme}
            options={[
              { value: "system", label: "Like the device" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={look.display === "eink"}
            onChange={(e) => look.setDisplay(e.target.checked ? "eink" : "standard")}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-medium">E-ink display</span>
            <span className="block text-xs text-ink-subtle">
              For e-readers: black and white, no animations, nothing see-through. Works with light and dark.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}

/** Practice on this device (as the app's Account → Practice). */
function PracticeOnDevice() {
  const [autoAdvance, setAutoAdvance] = useAutoAdvance();
  return (
    <section className="mt-10 max-w-md">
      <h2 className="text-xl font-semibold tracking-[-0.01em]">Practice</h2>
      <p className="mb-4 mt-1 text-sm text-ink-muted">On this device only.</p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={autoAdvance}
          onChange={(e) => setAutoAdvance(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="block text-sm font-medium">Move on after a right answer</span>
          <span className="block text-xs text-ink-subtle">
            Wrong answers always wait, so you can read the answer or ask the tutor. Enter moves on too.
          </span>
        </span>
      </label>
    </section>
  );
}

const PROVIDER_LABEL = {
  azure: "Natural voices (Azure)",
  edge: "Natural voices (Edge, unofficial)",
  gemini: "Gemini voices",
} as const;

/** A voice id as a name ("azure:de-DE-Seraphina:DragonHDLatestNeural" → "Seraphina HD (female) · Azure"). */
function voiceName(id: string): string {
  const provider = ttsProviderOf(id);
  const found = provider && serverVoices(provider).find((v) => `${provider}:${v.name}` === id);
  return found ? `${found.label} · ${provider[0]!.toUpperCase()}${provider.slice(1)}` : id;
}

/**
 * The voices: one for words (speaker buttons, tapped words) and one for a
 * story's "Read aloud" (by default the same). Each is the device's own or a
 * server voice (Azure or Edge).
 */
function VoiceSettings({
  ttsVoice,
  readerVoice,
  onChange,
}: {
  ttsVoice: string;
  readerVoice: string;
  onChange: (change: { ttsVoice?: string; readerVoice?: string }) => void;
}) {
  const status = useAsync(() => api.ttsStatus(), []);
  const ready = status.status === "ready" ? status.data : null;
  const available = !!ready?.available;
  const installed = ready?.installed ?? [];

  const [problem, setProblem] = useState<{ which: "words" | "reading"; text: string } | null>(null);
  /** Play a sample in a voice; a server voice that fails says why (rather than the device voice standing in). */
  async function test(which: "words" | "reading", voice: string, text: string) {
    setProblem(null);
    const server = voice !== "" && voice !== "device" && installed.includes(voice);
    if (server) {
      const res = await fetch(api.ttsUrl(voice, text), { credentials: "include" }).catch(() => null);
      if (!res?.ok) {
        const reason = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
        return setProblem({ which, text: `Couldn't play this voice: ${reason ?? "the server didn't answer"}.` });
      }
    }
    if (which === "words") speak(text);
    else void speech.speakSequence([text]);
  }
  const problemFor = (which: "words" | "reading") =>
    problem?.which === which ? <p className="mt-2 text-sm text-danger">{problem.text}</p> : null;

  function change(next: { ttsVoice?: string; readerVoice?: string }) {
    setProblem(null);
    onChange(next);
    // Hear the choice at once (it's kept for the account on Save).
    if (ready) {
      const tts = serverTtsFor(ready, { ttsVoice, readerVoice, ...next });
      setServerTts(tts);
      setListeningEnabled(tts.readerEnabled);
    }
  }

  const serverOptions = (value: string) => (
    <>
      {available &&
        (["azure", "edge", "gemini"] as const).map((provider) => {
          const list = (ready?.voices ?? []).filter((v) => v.provider === provider && installed.includes(v.id));
          if (!list.length) return null;
          return (
            <optgroup key={provider} label={PROVIDER_LABEL[provider]}>
              {list.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label.replace(/ · (Azure|Edge|Gemini)$/, "")}
                </option>
              ))}
            </optgroup>
          );
        })}
      {value && value !== "device" && !installed.includes(value) && <option value={value}>{voiceName(value)} (not available now)</option>}
    </>
  );

  return (
    <>
      <Field label="Voice for words">
        <select value={ttsVoice} onChange={(e) => change({ ttsVoice: e.target.value })} className="input">
          <option value="">Device voice (this browser)</option>
          {serverOptions(ttsVoice)}
        </select>
        {(ttsVoice === "" || readerVoice === "device") && <DeviceVoicePicker />}
        <div className="mt-2">
          <button
            type="button"
            onClick={() => void test("words", ttsVoice, "Guten Tag! Ich lerne Deutsch mit dem Baby.")}
            className="rounded-control border border-line-control px-3 py-1.5 text-sm hover:border-line-strong "
          >
            <SpeakerIcon className="h-4 w-4" />
            Test
          </button>
          {problemFor("words")}
        </div>
      </Field>
      <p className="-mt-2 text-xs text-ink-subtle">Speaker buttons in Vocab and flashcards, and words you tap.</p>
      <Field label="Voice for reading aloud">
        <select value={readerVoice} onChange={(e) => change({ readerVoice: e.target.value })} className="input">
          <option value="">Same as for words</option>
          <option value="device">Device voice (this browser)</option>
          {serverOptions(readerVoice)}
        </select>
        <div className="mt-2">
          <button
            type="button"
            onClick={() =>
              void test("reading", readerVoice === "" ? ttsVoice : readerVoice, "Es war einmal ein kleines Dorf am Rand eines großen Waldes.")
            }
            className="rounded-control border border-line-control px-3 py-1.5 text-sm hover:border-line-strong "
          >
            <SpeakerIcon className="h-4 w-4" />
            Test
          </button>
          {problemFor("reading")}
        </div>
      </Field>
      <p className="-mt-2 text-xs text-ink-subtle">
        A story's “Read aloud”, paragraph by paragraph.
        {available
          ? (ready?.voices ?? []).some((v) => v.id.includes("DragonHD") && installed.includes(v.id)) && " The HD voices sound most natural here."
          : " Natural German voices can be set up by the admin (Administration → Server → Read-aloud voices)."}
      </p>
    </>
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
      <span className="mb-1 block text-xs font-medium text-ink-subtle">
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
      <p className="mt-1 text-xs text-ink-subtle">
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
      <p className="text-sm text-ink-muted">
        Signed in as <span className="font-medium text-ink ">{user?.username}</span>
        {user?.role === "admin" && " (admin)"}
      </p>
      <AccountIcon />
      <DisplayName />
      <form onSubmit={changePassword} className="space-y-4">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">Change password</h2>
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
          className={`${btn.primary}`}
        >
          {busy ? "…" : "Change password"}
        </button>
        {message && (
          <p className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>
        )}
      </form>
    </div>
  );
}

/** Your icon: a pixel pattern (shuffle for another) or your initial. */
function AccountIcon() {
  const { avatar, style, setStyle, shuffle } = useAvatar();
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    fn().catch(() => {}).finally(() => setBusy(false));
  };
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-[-0.01em]">Icon</h2>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar avatar={avatar} size={56} />
        <TabPills
          label="Icon style"
          size="sm"
          options={[
            { value: "pattern", label: "Pattern" },
            { value: "letter", label: "Letter" },
          ]}
          value={style}
          onChange={(v) => run(() => setStyle(v))}
        />
        <button type="button" disabled={busy} onClick={() => run(shuffle)} className={btn.secondary}>
          <ShuffleIcon className="h-4 w-4" />
          Shuffle
        </button>
      </div>
    </section>
  );
}

/** The name the app greets you with (part of the settings row). */
function DisplayName() {
  const loaded = useAsync(() => api.settings(), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded.status === "ready") setForm(loaded.data);
  }, [loaded.status]);

  if (!form) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    // Merge into the latest settings so a stale copy can't undo other changes.
    const latest = await api.settings();
    await api.saveSettings({ ...latest, displayName: form.displayName });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Display name">
        <input
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          className="input"
        />
      </Field>
      <button type="submit" className={btn.secondary}>
        Save name
      </button>
      {saved && <span className="ml-3 text-sm text-success">Saved</span>}
    </form>
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
      <h2 className="text-xl font-semibold tracking-[-0.01em]">Connected apps</h2>
      <p className="text-sm text-ink-muted">
        To connect an AI agent like Claude, add a custom connector with the URL{" "}
        <code className="break-all">{`${window.location.origin}/mcp`}</code>. It will ask you to
        sign in here and allow access.
      </p>
      {grants && grants.length === 0 && <p className="text-sm text-ink-subtle">No apps connected.</p>}
      {grants && grants.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-card border border-line text-sm ">
          {grants.map((g) => (
            <li key={g.id} className="flex items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{g.clientName}</p>
                <p className="text-xs text-ink-subtle">
                  connected {timeAgo(g.createdAt)} ·{" "}
                  {g.lastUsedAt ? `last used ${timeAgo(g.lastUsedAt)}` : "never used"}
                </p>
              </div>
              <button
                type="button"
                className="rounded-control border border-line-control px-2.5 py-1 text-xs font-medium text-danger "
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
      <h2 className="text-xl font-semibold tracking-[-0.01em]">API tokens</h2>
      <p className="text-sm text-ink-muted">
        For scripts and integrations: send <code>Authorization: Bearer &lt;token&gt;</code>. A
        token can do everything you can, except manage tokens or change your password. API docs:{" "}
        <a href="/api/docs" className="underline" target="_blank" rel="noreferrer">
          /api/docs
        </a>
        .
      </p>
      <p className="text-sm text-ink-muted">
        MCP connectors that take a header instead of signing in: URL{" "}
        <code className="break-all">{`${window.location.origin}/mcp`}</code> with{" "}
        <code>Authorization: Bearer &lt;token&gt;</code>.
      </p>
      {created && (
        <div className="rounded-control bg-warning-soft p-3 text-sm ">
          <p className="mb-2 font-medium">Copy it now — it won't be shown again:</p>
          <code className="block break-all rounded bg-surface p-2 text-xs ">{created}</code>
          <button
            type="button"
            className={`${btn.secondary} ${btn.sm} mt-2`}
            onClick={() => {
              void navigator.clipboard.writeText(created);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {tokens && tokens.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-card border border-line text-sm ">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-ink-subtle">
                  {t.prefix}… · {t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : "never used"}
                </p>
              </div>
              <button
                type="button"
                className="rounded-control border border-line-control px-2.5 py-1 text-xs font-medium text-danger "
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
          className={`${btn.primary} shrink-0`}
        >
          Create token
        </button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
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
