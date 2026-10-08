import { useEffect } from "react";
import { Navigate, NavLink, Outlet, useMatch } from "react-router-dom";
import { api } from "./lib/api";
import { useAuth } from "./lib/auth";
import { AppTitle } from "./components/AppTitle";
import {
  HomeIcon,
  LogOutIcon,
  NotesIcon,
  PracticeIcon,
  SettingsIcon,
  SheetsIcon,
  StoriesIcon,
  VocabIcon,
} from "./components/icons";
import { setServerTts } from "./lib/tts";
import { VocabProvider } from "./lib/vocab";

const navItems = [
  { to: "/", label: "Home", end: true, Icon: HomeIcon },
  { to: "/exercises", label: "Practice", Icon: PracticeIcon },
  { to: "/cheatsheets", label: "Sheets", Icon: SheetsIcon },
  { to: "/stories", label: "Stories", Icon: StoriesIcon },
  { to: "/vocab", label: "Vocab", Icon: VocabIcon },
  { to: "/notes", label: "Notes", Icon: NotesIcon },
];
const mobileItems = [...navItems, { to: "/settings", label: "Settings", end: false, Icon: SettingsIcon }];

const iconButton = (active = false) =>
  `grid h-9 w-9 place-items-center rounded-full transition-colors ${
    active ? "bg-surface-sunken text-ink" : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
  }`;

export function App() {
  const { authenticated, loading, logout } = useAuth();
  // The story reader takes the whole screen (no header or tab bar).
  const storyMatch = useMatch("/stories/:id");
  const immersive = Boolean(storyMatch && !["new", "generate"].includes(storyMatch.params.id ?? ""));
  // Full screen belongs to the reader: leave it when leaving the reader.
  useEffect(() => {
    if (!immersive && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [immersive]);

  // Wire up the server voice (if one is chosen and available).
  useEffect(() => {
    if (!authenticated) return;
    Promise.all([api.ttsStatus(), api.settings()])
      .then(([st, se]) =>
        setServerTts({
          enabled: st.available && st.installed.includes(se.ttsVoice),
          voice: se.ttsVoice,
        }),
      )
      .catch(() => {});
  }, [authenticated]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-slate-500">
        Loading…
      </div>
    );
  }
  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  if (immersive) {
    return (
      <VocabProvider>
        <Outlet />
      </VocabProvider>
    );
  }

  return (
    <VocabProvider>
    <div className="min-h-screen">
      {/* Raycast-style bar: brand left, the section pills centred, account right. */}
      <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] backdrop-blur-xl">
        <div className="mx-auto grid h-14 max-w-5xl grid-cols-[1fr_auto] items-center gap-3 px-4 md:grid-cols-[1fr_auto_1fr]">
          <NavLink to="/" className="min-w-0 justify-self-start rounded-control text-base font-semibold tracking-tight">
            <AppTitle />
          </NavLink>
          <nav
            aria-label="Main"
            className="hidden items-center gap-0.5 rounded-full border border-line bg-surface-sunken p-1 md:flex"
          >
            {navItems.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-surface-raised text-ink shadow-card"
                      : "text-ink-muted hover:text-ink"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1 justify-self-end">
            <NavLink to="/settings" aria-label="Settings" title="Settings" className={({ isActive }) => `hidden md:grid ${iconButton(isActive)}`}>
              <SettingsIcon className="h-[18px] w-[18px]" />
            </NavLink>
            <button type="button" onClick={() => void logout()} aria-label="Log out" title="Log out" className={iconButton()}>
              <LogOutIcon className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-8 md:pb-16">
        <Outlet />
      </main>

      {/* Mobile tab bar: the active tab's icon sits in a soft pill. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-line bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        {mobileItems.map(({ to, label, end, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `group flex min-w-0 flex-col items-center gap-1 px-0.5 pb-2 pt-2 text-[10px] font-medium leading-tight ${
                isActive ? "is-active text-brand-ink" : "text-ink-subtle"
              }`
            }
          >
            <span className="grid h-7 w-12 place-items-center rounded-full transition-colors group-[.is-active]:bg-brand-soft">
              <Icon className="h-5 w-5 shrink-0" />
            </span>
            <span className="w-full truncate text-center">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
    </VocabProvider>
  );
}
