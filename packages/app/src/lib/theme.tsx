import { createContext, useContext, useMemo, type ReactNode } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { useEffect, useState } from "react";
import { preferences } from "@mdb/client";
import { nativeTheme, type NativeTheme } from "@mdb/client/tokens";
import { usePreference } from "@mdb/client/react";

/**
 * The look of every screen: tokens from @mdb/client/tokens for this device's
 * scheme (its own choice, or the system's) and display (standard or e-ink),
 * with no motion under the system's reduce-motion setting.
 */
type Theme = NativeTheme & {
  setScheme: (s: "system" | "light" | "dark") => void;
  setDisplay: (d: "standard" | "eink") => void;
  schemeChoice: "system" | "light" | "dark";
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [schemeChoice, setScheme] = usePreference(preferences.colorScheme);
  const [display, setDisplay] = usePreference(preferences.display);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  const scheme = schemeChoice === "system" ? (system === "dark" ? "dark" : "light") : schemeChoice;
  const value = useMemo(
    () => ({ ...nativeTheme(display, scheme, { reduceMotion }), setScheme, setDisplay, schemeChoice }),
    [display, scheme, reduceMotion, schemeChoice], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("useTheme must be used within ThemeProvider");
  return t;
}

/** The app's font families (loaded in the root layout). */
export const font = {
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semibold: "Geist_600SemiBold",
  bold: "Geist_700Bold",
  mono: "GeistMono_500Medium",
};
