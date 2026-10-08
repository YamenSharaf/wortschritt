import { useEffect } from "react";
import { Navigate, NavLink, Outlet, useMatch } from "react-router-dom";
import { ThemePicker } from "./components/ThemePicker";
import { api } from "./lib/api";
import { useAuth } from "./lib/auth";
import { AppTitle } from "./components/AppTitle";
import { useTheme } from "./lib/theme";
import { setServerTts } from "./lib/tts";
import { VocabProvider } from "./lib/vocab";

type IconProps = { className?: string };
const Home = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 9.5V21h14V9.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Book = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M19 17H6" strokeLinecap="round" />
  </svg>
);
const Dumbbell = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="M6.5 6.5 17.5 17.5M4 8v8M8 5v14M16 5v14M20 8v8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Gear = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" strokeLinecap="round" />
  </svg>
);
const OpenBook = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="M12 6.5C10 5 7 4.5 3 5v13c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5Z" strokeLinejoin="round" />
    <path d="M12 6.5v13" strokeLinecap="round" />
  </svg>
);
const Cards = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <rect x="3" y="7" width="14" height="12" rx="2" strokeLinejoin="round" />
    <path d="M7 4h11a2 2 0 0 1 2 2v9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Pencil = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17.2V20Z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 7.5 16.5 10" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const navItems = [
  { to: "/", label: "Home", end: true, Icon: Home },
  { to: "/cheatsheets", label: "Sheets", Icon: Book },
  { to: "/exercises", label: "Practice", Icon: Dumbbell },
  { to: "/stories", label: "Stories", Icon: OpenBook },
  { to: "/vocab", label: "Vocab", Icon: Cards },
  { to: "/notes", label: "Notes", Icon: Pencil },
  { to: "/settings", label: "Settings", Icon: Gear },
];

function ThemeToggle() {
  const { setTheme } = useTheme();
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export function App() {
  const { authenticated, loading, logout } = useAuth();
  const { setTheme, hasStored } = useTheme();
  // The story reader takes the whole screen (no header or tab bar).
  const storyMatch = useMatch("/stories/:id");
  const immersive = Boolean(storyMatch && !["new", "generate"].includes(storyMatch.params.id ?? ""));
  // Full screen belongs to the reader: leave it when leaving the reader.
  useEffect(() => {
    if (!immersive && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [immersive]);

  // On a device with no saved theme yet, inherit the account default once.
  useEffect(() => {
    if (authenticated && !hasStored) {
      api
        .settings()
        .then((s) => setTheme(s.theme))
        .catch(() => {});
    }
  }, [authenticated, hasStored, setTheme]);

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
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-2.5">
          <NavLink
            to="/"
            className="min-w-0 shrink text-base font-bold"
          >
            <AppTitle />
          </NavLink>
          <nav className="ml-3 hidden flex-1 gap-1 text-sm md:flex">
            {navItems.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemePicker />
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-24 pt-6 md:pb-12">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar — one fixed column per item */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 overflow-hidden border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden">
        {navItems.map(({ to, label, end, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-w-0 flex-col items-center gap-0.5 border-t-2 px-0.5 pb-1.5 pt-1 ${
                isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-slate-400 dark:text-slate-500"
              }`
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="w-full truncate text-center text-[10px] leading-tight">
              {label}
            </span>
          </NavLink>
        ))}
      </nav>
    </div>
    </VocabProvider>
  );
}
