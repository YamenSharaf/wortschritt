import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ACCENT_IDS, DEFAULT_ACCENT, type AccentId } from "./themes";

export type Theme = "system" | "light" | "dark";
const MODE_KEY = "mdb-theme";
const ACCENT_KEY = "mdb-accent";

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The single place that touches the DOM for the light/dark class. */
function applyMode(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && systemDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

function applyAccent(accent: AccentId): void {
  document.documentElement.dataset.accent = accent;
}

function readMode(): Theme | null {
  const v = localStorage.getItem(MODE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : null;
}
function readAccent(): AccentId {
  const v = localStorage.getItem(ACCENT_KEY) as AccentId | null;
  return v && ACCENT_IDS.includes(v) ? v : DEFAULT_ACCENT;
}

type Ctx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  hasStored: boolean;
  accent: AccentId;
  setAccent: (a: AccentId) => void;
};
const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readMode() ?? "system");
  const [hasStored, setHasStored] = useState<boolean>(() => readMode() !== null);
  const [accent, setAccentState] = useState<AccentId>(() => readAccent());

  useEffect(() => {
    applyMode(theme);
  }, [theme]);
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  // Follow the OS when in "system" mode.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (theme === "system") applyMode("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(MODE_KEY, t);
    setHasStored(true);
    setThemeState(t);
  }, []);

  const setAccent = useCallback((a: AccentId) => {
    localStorage.setItem(ACCENT_KEY, a);
    setAccentState(a);
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, hasStored, accent, setAccent }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  const c = useContext(ThemeContext);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
}
