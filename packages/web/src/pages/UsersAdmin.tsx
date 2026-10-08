import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MIN_PASSWORD_LENGTH, NEURAL_VOICES, type AdminUser, type RegistrationStatus, type TtsAdminSettings } from "@mdb/shared";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/time";

const smallBtn =
  "rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:border-slate-500 disabled:opacity-50 dark:border-slate-700";

/** Admin-only: the registration switch and account management. */
export function UsersAdmin() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [registration, setRegistration] = useState<RegistrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [u, r] = await Promise.all([api.adminUsers(), api.adminRegistration()]);
    setUsers(u);
    setRegistration(r);
  }
  useEffect(() => {
    reload().catch(() => setError("Couldn't load users."));
  }, []);

  /** Run an admin action, then refresh; surface the server's reason on failure. */
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  if (!users || !registration) {
    return <p className="text-slate-500">{error ?? "Loading…"}</p>;
  }

  return (
    <div className="max-w-2xl space-y-8">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Registration</h2>
        <p className="text-sm text-slate-500">
          {registration.open && registration.openUntil
            ? `Open — anyone with the link can create an account until ${new Date(
                registration.openUntil * 1000,
              ).toLocaleString()}. It closes by itself after 24 hours.`
            : "Closed — only existing accounts can sign in."}
        </p>
        <button
          type="button"
          onClick={() => act(() => api.adminSetRegistration(!registration.open))}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
        >
          {registration.open ? "Close registration now" : "Open registration for 24 hours"}
        </button>
      </section>

      <TimezoneSetting />

      <TtsProviders />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Users</h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {users.map((u) => (
            <UserRow key={u.id} user={u} isMe={u.username === me?.username} act={act} />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Every IANA zone the browser knows, plus UTC. */
function allTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf?.("timeZone") ?? [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

/** The server-wide time zone: when "today" starts, and the days in history. */
function TimezoneSetting() {
  const [timezone, setTimezone] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(allTimezones, []);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    api
      .timezone()
      .then((r) => setTimezone(r.timezone))
      .catch(() => setError("Couldn't load the time zone."));
  }, []);

  async function change(tz: string) {
    setError(null);
    setSaved(false);
    try {
      setTimezone((await api.setTimezone(tz)).timezone);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the time zone.");
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Time zone</h2>
      <p className="text-sm text-slate-500">
        For everyone on this server: when a new day starts for the daily goal, and how practice
        history is grouped by day.
      </p>
      {timezone && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={zones.includes(timezone) ? timezone : ""}
            onChange={(e) => void change(e.target.value)}
            className="input max-w-xs"
          >
            {!zones.includes(timezone) && <option value="">{timezone}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {timezone !== browserZone && zones.includes(browserZone) && (
            <button
              type="button"
              onClick={() => void change(browserZone)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium dark:border-slate-700"
            >
              Use mine ({browserZone.replace(/_/g, " ")})
            </button>
          )}
          {saved && <span className="text-sm text-green-600">Saved ✓</span>}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

function UserRow({
  user,
  isMe,
  act,
}: {
  user: AdminUser;
  isMe: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [settingPassword, setSettingPassword] = useState(false);
  const [password, setPassword] = useState("");

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    await act(() => api.adminSetPassword(user.id, password));
    setSettingPassword(false);
    setPassword("");
  }

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{user.username}</span>
        {isMe && <span className="text-xs text-slate-400">(you)</span>}
        {user.role === "admin" && (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
            admin
          </span>
        )}
        {user.disabled && (
          <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            disabled
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {user.lastLoginAt ? `last sign-in ${timeAgo(user.lastLoginAt)}` : "never signed in"}
        </span>
      </div>
      {!isMe && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={smallBtn}
            onClick={() => act(() => api.adminUpdateUser(user.id, { disabled: !user.disabled }))}
          >
            {user.disabled ? "Enable" : "Disable"}
          </button>
          <button
            type="button"
            className={smallBtn}
            onClick={() =>
              act(() =>
                api.adminUpdateUser(user.id, { role: user.role === "admin" ? "user" : "admin" }),
              )
            }
          >
            {user.role === "admin" ? "Make regular user" : "Make admin"}
          </button>
          <button
            type="button"
            className={smallBtn}
            onClick={() => setSettingPassword((v) => !v)}
          >
            Set password
          </button>
          <button
            type="button"
            className={`${smallBtn} text-red-600`}
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${user.username}? Their vocab, notes and progress are deleted too. Content they imported stays.`,
                )
              ) {
                void act(() => api.adminDeleteUser(user.id));
              }
            }}
          >
            Delete
          </button>
        </div>
      )}
      {settingPassword && (
        <form onSubmit={submitPassword} className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            autoComplete="new-password"
            placeholder={`Temporary password (${MIN_PASSWORD_LENGTH}+ characters)`}
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input max-w-xs flex-1"
          />
          <button
            type="submit"
            disabled={password.length < MIN_PASSWORD_LENGTH}
            className={smallBtn}
          >
            Save
          </button>
          <span className="w-full text-xs text-slate-400">
            Signs {user.username} out everywhere. Tell them the new password; they can change it
            under Settings → Account.
          </span>
        </form>
      )}
    </li>
  );
}

/**
 * Read-aloud voices for everyone on this server: Azure Speech neural voices
 * (the admin's key; free tier 0.5M characters a month) and the unofficial
 * Edge voices. Piper is configured with TTS_URL on the server.
 */
function TtsProviders() {
  const [cfg, setCfg] = useState<TtsAdminSettings | null>(null);
  const [region, setRegion] = useState("westeurope");
  const [key, setKey] = useState("");
  const [voice, setVoice] = useState("azure:de-DE-KatjaNeural");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .adminTts()
      .then((c) => {
        setCfg(c);
        if (c.azure.region) setRegion(c.azure.region);
        if (!c.azure.configured && c.edge.enabled) setVoice("edge:de-DE-KatjaNeural");
      })
      .catch(() => setMsg({ ok: false, text: "Couldn't load the voice settings." }));
  }, []);

  async function run(fn: () => Promise<TtsAdminSettings>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      setCfg(await fn());
      setKey("");
      setMsg({ ok: true, text: done });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      await api.adminTestTts(voice);
      // Play the sample too (served from the server, cached after the first time).
      const sample = new Audio(`/api/tts?${new URLSearchParams({ voice, text: "Guten Tag! Ich lerne Deutsch." })}`);
      await sample.play().catch(() => {});
      setMsg({ ok: true, text: "It works ✓ — pick the voice under Preferences → Pronunciation voice." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "The test failed." });
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return msg ? <p className="text-sm text-red-600">{msg.text}</p> : null;
  const testable = cfg.azure.configured || cfg.edge.enabled;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Read-aloud voices</h2>
        <p className="text-sm text-slate-500">
          Natural German voices for everyone on this server (reading aloud and pronunciation).
          Piper: {cfg.piper.configured ? "configured" : "not configured (TTS_URL)"}.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">Azure Speech</h3>
          <span className={`text-xs ${cfg.azure.configured ? "text-green-600" : "text-slate-400"}`}>
            {cfg.azure.configured ? "Set up ✓" : "Not set up"}
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Microsoft's neural voices (Katja, Conrad, Seraphina…). Create a Speech resource in Azure (the
          free tier has 0.5 million characters a month; clips are cached) and paste its key and region.
        </p>
        {!cfg.azure.canStoreKey ? (
          <p className="text-xs text-amber-600">Set ENCRYPTION_KEY on the server to store a key.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input value={region} onChange={(e) => setRegion(e.target.value.trim())} placeholder="Region, e.g. westeurope" className="input w-44" />
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={cfg.azure.configured ? "Key (leave empty to keep)" : "Key"}
              type="password"
              autoComplete="off"
              className="input min-w-0 flex-1"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => api.adminSetTts({ azure: { region, ...(key ? { key } : {}) } }), "Saved.")}
              className={smallBtn}
            >
              Save
            </button>
            {cfg.azure.configured && (
              <button type="button" disabled={busy} onClick={() => run(() => api.adminSetTts({ azure: null }), "Removed.")} className={smallBtn}>
                Remove
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={cfg.edge.enabled}
            disabled={busy}
            onChange={(e) => run(() => api.adminSetTts({ edge: e.target.checked }), e.target.checked ? "Edge voices on." : "Edge voices off.")}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Edge voices (free, unofficial)</span>
            <span className="block text-xs text-slate-500">
              The same natural voices through the endpoint Microsoft Edge's "Read aloud" uses — no account,
              but not an official API: it can change or stop working at any time.
            </span>
          </span>
        </label>
      </div>

      {testable && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={voice} onChange={(e) => setVoice(e.target.value)} className="input w-auto">
            {(["azure", "edge"] as const)
              .filter((p) => (p === "azure" ? cfg.azure.configured : cfg.edge.enabled))
              .flatMap((p) =>
                NEURAL_VOICES.map((v) => (
                  <option key={`${p}:${v.name}`} value={`${p}:${v.name}`}>
                    {v.label} · {p === "azure" ? "Azure" : "Edge"}
                  </option>
                )),
              )}
          </select>
          <button type="button" disabled={busy} onClick={() => void test()} className={smallBtn}>
            Test
          </button>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>}
    </section>
  );
}
