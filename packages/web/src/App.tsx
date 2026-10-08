import { useEffect } from "react";
import { Navigate, NavLink, Outlet, useMatch } from "react-router-dom";
import { api } from "./lib/api";
import { useAuth } from "./lib/auth";
import { AccountMenu } from "./components/AccountMenu";
import { AppTitle } from "./components/AppTitle";
import {
  HomeIcon,
  NotesIcon,
  PracticeIcon,
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

export function App() {
  const { authenticated, loading } = useAuth();
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
      <div className="grid min-h-screen place-items-center text-ink-muted">
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
      {/* A floating bar (Raycast-style): the mark left, sections centred, account right. */}
      <div className="sticky top-0 z-30 px-3 pt-3 sm:px-4">
        <header className="ws-bar mx-auto grid h-14 max-w-5xl grid-cols-[1fr_auto] items-center gap-3 px-3 sm:px-4 md:grid-cols-[1fr_auto_1fr]">
          <NavLink to="/" className="min-w-0 justify-self-start rounded-control text-base font-semibold tracking-tight">
            <AppTitle />
          </NavLink>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {navItems.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `rounded-chip px-2.5 py-1.5 text-sm font-medium tracking-[0.2px] transition-colors ${
                    isActive ? "bg-surface-sunken text-ink" : "text-ink-muted hover:text-ink"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center justify-self-end">
            <AccountMenu />
          </div>
        </header>
      </div>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-5 md:pb-16">
        <Outlet />
      </main>

      {/* Mobile dock: a floating glass pill; the active section sits in a soft pill. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] md:hidden">
        <nav aria-label="Main" className="ws-dock pointer-events-auto mx-auto grid max-w-md grid-cols-6 p-1.5">
          {navItems.map(({ to, label, end, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-w-0 flex-col items-center gap-0.5 rounded-full px-0.5 py-1.5 text-[10px] font-medium leading-tight transition-colors ${
                  isActive ? "bg-brand-soft text-brand-ink" : "text-ink-muted hover:text-ink"
                }`
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="w-full truncate text-center">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
    </VocabProvider>
  );
}
