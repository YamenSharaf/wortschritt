import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "mdb-theme";

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The single place that touches the DOM for theming. */
function apply(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && systemDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

function readStored(): Theme | null {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : null;
}

type Ctx = { theme: Theme; setTheme: (t: Theme) => void; hasStored: boolean };
const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored() ?? "system");
  const [hasStored, setHasStored] = useState<boolean>(() => readStored() !== null);

  // Apply on every change (source of truth for the .dark class).
  useEffect(() => {
    apply(theme);
  }, [theme]);

  // Follow the OS when in "system" mode.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (theme === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(KEY, t);
    setHasStored(true);
    setThemeState(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, hasStored }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  const c = useContext(ThemeContext);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
}
