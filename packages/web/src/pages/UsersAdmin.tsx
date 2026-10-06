import { useEffect, useState, type FormEvent } from "react";
import { MIN_PASSWORD_LENGTH, type AdminUser, type RegistrationStatus } from "@mdb/shared";
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
