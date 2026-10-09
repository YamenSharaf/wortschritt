import { preferences } from "@mdb/client";
import { usePreference } from "@mdb/client/react";

type Scheme = (typeof preferences.colorScheme)["fallback"];
type Display = (typeof preferences.display)["fallback"];

/**
 * Show this device's appearance: data-scheme (light/dark; none follows the
 * device) and data-display (eink) on <html>, which pick the tokens in
 * tokens.css. index.html does the same before the first paint.
 */
export function applyAppearance(scheme: Scheme, display: Display) {
  const root = document.documentElement;
  if (scheme === "system") delete root.dataset.scheme;
  else root.dataset.scheme = scheme;
  if (display === "eink") root.dataset.display = "eink";
  else delete root.dataset.display;
}

/** Whether this device shows the e-ink look. */
export const isEink = () => document.documentElement.dataset.display === "eink";

/** The scheme and display chosen on this device; changing one applies it at once. */
export function useAppearance() {
  const [scheme, setScheme] = usePreference(preferences.colorScheme);
  const [display, setDisplay] = usePreference(preferences.display);
  return {
    scheme,
    display,
    setScheme(next: Scheme) {
      setScheme(next);
      applyAppearance(next, display);
    },
    setDisplay(next: Display) {
      setDisplay(next);
      applyAppearance(scheme, next);
    },
  };
}
