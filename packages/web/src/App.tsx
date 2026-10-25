import { useEffect } from "react";
import { Navigate, NavLink, Outlet, useMatch } from "react-router-dom";
import { api } from "./lib/api";
import { useAuth } from "@mdb/client/react";
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
import { serverTtsFor } from "@mdb/client";
import { setServerTts } from "./lib/tts";
import { setListeningEnabled, useListening } from "./lib/listening";
import { MiniPlayer, PlayerPanel } from "./components/Player";
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
  const listening = useListening().phase !== "idle";
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
      .then(([st, se]) => {
        const tts = serverTtsFor(st, se);
        setServerTts(tts);
        // A server reading voice: stories are listened to as one file (lib/listening).
        setListeningEnabled(tts.readerEnabled);
      })
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
        <PlayerPanel />
      </VocabProvider>
    );
  }

  return (
    <VocabProvider>
    <div className="min-h-screen">
      {/* A floating bar (Raycast-style): the mark left, sections centred, account right. */}
      <div className="sticky top-0 z-30 px-3 pt-3 sm:px-4 rail:hidden print:hidden">
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

      {/* Wide and landscape: the sections stand on their side at the left edge, the mark above, the account below. */}
      <div className="fixed inset-y-0 left-0 z-30 hidden w-[104px] flex-col items-center py-5 rail:flex print:hidden">
        <NavLink to="/" aria-label="Home" className="rounded-control">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
        </NavLink>
        <div className="flex flex-1 items-center">
          <nav aria-label="Main" className="ws-dock flex flex-col gap-1 !rounded-[28px] p-1.5">
            {navItems.map(({ to, label, end, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-[20px] text-[10.5px] font-medium leading-tight transition-colors ${
                    isActive ? "bg-brand-soft text-brand-ink" : "text-ink-muted hover:text-ink"
                  }`
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
        <AccountMenu />
      </div>

      <main className={`mx-auto max-w-5xl px-4 pt-6 sm:px-5 rail:max-w-[1200px] rail:pl-[128px] rail:pr-8 rail:pt-8 ${listening ? "pb-48 md:pb-28" : "pb-28 md:pb-16"} print:max-w-none print:p-0`}>
        <Outlet />
      </main>

      {/* Mobile dock: a floating glass pill; the active section sits in a soft pill. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] md:hidden print:hidden">
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
      <MiniPlayer />
      <PlayerPanel />
    </div>
    </VocabProvider>
  );
}
