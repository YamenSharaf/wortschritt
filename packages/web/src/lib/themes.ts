/** Accent themes. Each has a light + dark variant defined in index.css via the
 *  --accent / --accent-foreground CSS variables (see [data-accent] blocks). */
export const ACCENTS = [
  { id: "slate", label: "Slate", swatch: "#0f172a" },
  { id: "emerald", label: "Emerald", swatch: "#059669" },
  { id: "blue", label: "Blue", swatch: "#2563eb" },
  { id: "violet", label: "Violet", swatch: "#7c3aed" },
  { id: "rose", label: "Rose", swatch: "#e11d48" },
  { id: "amber", label: "Amber", swatch: "#d97706" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];
export const ACCENT_IDS = ACCENTS.map((a) => a.id) as AccentId[];
export const DEFAULT_ACCENT: AccentId = "slate";
