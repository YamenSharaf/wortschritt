/**
 * The Wortschritt design tokens: one source for every frontend. The web's
 * CSS variables are generated from this file (packages/web/src/tokens.css,
 * `pnpm --filter @mdb/web tokens`); the app reads `nativeTheme()`.
 *
 * Two independent axes pick the values:
 * - scheme: light or dark (the device's choice, or the learner's);
 * - display: standard, or eink — a monochrome, slow-refresh screen (e.g. a
 *   Boox). E-ink has a light and a dark scheme too. It swaps colours for black,
 *   white and greys, shadows for hairlines, glass and gradients for solid
 *   fills, and sets every duration to 0.
 *
 * Tokens name a role (`elevation`, `glass`), not a look, so each display can
 * render the role its own way. See docs/design-system.md.
 */

export type Scheme = "light" | "dark";
export type Display = "standard" | "eink";

/** Every colour role. Values are hex (#rrggbb or #rrggbbaa). */
export type ColorTokens = {
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  borderControl: string;
  /** A faint top-edge light on tracks (transparent where it isn't wanted). */
  highlight: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  brand: string;
  brandHover: string;
  onBrand: string;
  brandSoft: string;
  brandInk: string;
  tileFrom: string;
  tileTo: string;
  glow: string;
  reward1: string;
  reward2: string;
  reward3: string;
  onReward: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  focus: string;
  onSection: string;
  sectionPractice: string;
  sectionSheets: string;
  sectionStories: string;
  sectionVocab: string;
  sectionNotes: string;
  /** The floating header bar (a gradient between these). */
  barFrom: string;
  barTo: string;
  barHighlight: string;
  /** Tab pills: the track, and the lit active pill. */
  tabsTrack: string;
  tabsActiveFrom: string;
  tabsActiveTo: string;
  tabsActiveBorder: string;
  /** The mobile dock. */
  dockFrom: string;
  dockTo: string;
  dockBorder: string;
  dockHighlight: string;
  dockShadow: string;
  /** Glass: the sheen at the top of a glass surface, and its lit edge. */
  glassSheen: string;
  glassEdge: string;
  /** Behind a sheet. */
  scrim: string;
};

/** Shadows (CSS box-shadow syntax, which React Native's `boxShadow` takes too). */
export type ElevationTokens = {
  card: string;
  cardHover: string;
  pop: string;
  /** Under a glass button. */
  glass: string;
};

/**
 * How glass and blur render. Percentages are how much of a tint colour a
 * glass surface mixes in; blurs are px of backdrop blur.
 */
export type EffectTokens = {
  blurBar: number;
  blurGlass: number;
  blurDock: number;
  blurReaderBar: number;
  /** Glass buttons: tint in the fill, on hover, and in the border. */
  glassFill: number;
  glassFillHover: number;
  glassBorder: number;
  /** Glass icons: tint in the fill and border, and white mixed into the icon. */
  glassIconFill: number;
  glassIconBorder: number;
  glassIconLighten: number;
  /** "Peek" translations: blur until revealed (0: hidden another way). */
  peekBlur: number;
};

/** Durations in ms; e-ink and reduced motion make them all 0. */
export type MotionTokens = {
  /** Hover and colour changes. */
  fast: number;
  /** Sheets, fades. */
  base: number;
  /** A page turn in the reader. */
  page: number;
  /** The shake of a wrong answer. */
  feedback: number;
  /** The glow of a right one. */
  celebrate: number;
  /** One beat of a loading pulse. */
  pulse: number;
};

/** A story reader palette, as "r g b" triplets (the reader mixes alpha in). */
export type ReaderPalette = {
  bg: string;
  fg: string;
  muted: string;
  rule: string;
  /** Read-aloud highlight. */
  mark: string;
  /** The dotted underline under saved words. */
  vocab: string;
};

const standardLight: ColorTokens = {
  bg: "#f6f7fa",
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  surfaceSunken: "#eef1f6",
  border: "#e3e7ee",
  borderStrong: "#c9d0db",
  borderControl: "#838b9c",
  highlight: "#ffffff00",
  ink: "#0f1420",
  inkMuted: "#566074",
  inkSubtle: "#646d80",
  brand: "#2b6cb0",
  brandHover: "#245c98",
  onBrand: "#ffffff",
  brandSoft: "#e8f1fb",
  brandInk: "#1f5a99",
  tileFrom: "#4a90e2",
  tileTo: "#22589a",
  glow: "#4a90e21f",
  reward1: "#ffd95a",
  reward2: "#ff8a65",
  reward3: "#f0508c",
  onReward: "#0f1420",
  success: "#127a4b",
  successSoft: "#e5f5ed",
  danger: "#c2362b",
  dangerSoft: "#fbebe9",
  warning: "#9a5b00",
  warningSoft: "#fdf2dd",
  focus: "#2b6cb0",
  onSection: "#ffffff",
  sectionPractice: "#2b6cb0",
  sectionSheets: "#0f8583",
  sectionStories: "#d4512a",
  sectionVocab: "#a8701a",
  sectionNotes: "#6d4fd1",
  barFrom: "#ffffffbf",
  barTo: "#ffffffe6",
  barHighlight: "#ffffff",
  tabsTrack: "#eef1f6",
  tabsActiveFrom: "#ffffff",
  tabsActiveTo: "#f3f5f9",
  tabsActiveBorder: "#d9dee7",
  dockFrom: "#ffffffb8",
  dockTo: "#f6f7fa99",
  dockBorder: "#ffffffcc",
  dockHighlight: "#ffffff",
  dockShadow: "#0f142021",
  glassSheen: "#ffffff66",
  glassEdge: "#ffffffb3",
  scrim: "#080a1052",
};

const standardDark: ColorTokens = {
  ...standardLight,
  bg: "#0b0d12",
  surface: "#12151c",
  surfaceRaised: "#191d27",
  surfaceSunken: "#0e1117",
  border: "#ffffff14",
  borderStrong: "#ffffff29",
  borderControl: "#646b7a",
  highlight: "#ffffff0f",
  ink: "#edf0f5",
  inkMuted: "#9aa3b2",
  inkSubtle: "#7d8696",
  brand: "#5aa9f5",
  brandHover: "#7bbbf8",
  onBrand: "#0b0d12",
  brandSoft: "#5aa9f51f",
  brandInk: "#8ec5ff",
  glow: "#4a90e238",
  success: "#3dd68c",
  successSoft: "#3dd68c1f",
  danger: "#ff7a6e",
  dangerSoft: "#ff7a6e1f",
  warning: "#f5b544",
  warningSoft: "#f5b5441f",
  focus: "#8ec5ff",
  barFrom: "#121520bf",
  barTo: "#0c0e13e6",
  barHighlight: "#ffffff26",
  tabsTrack: "#0f1218",
  tabsActiveFrom: "#4b5262",
  tabsActiveTo: "#1a1d25",
  tabsActiveBorder: "#ffffff1a",
  dockFrom: "#1a1e28b3",
  dockTo: "#0f121899",
  dockBorder: "#ffffff1f",
  dockHighlight: "#ffffff1f",
  dockShadow: "#00000080",
  glassSheen: "#ffffff0d",
  glassEdge: "#ffffff1f",
};

/**
 * E-ink: black on white. Greys are kept few and far apart so they survive a
 * 16-level panel; every accent is ink, so meaning comes from icons and type.
 */
const einkLight: ColorTokens = {
  bg: "#ffffff",
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  surfaceSunken: "#ececec",
  border: "#8c8c8c",
  borderStrong: "#404040",
  borderControl: "#000000",
  highlight: "#ffffff00",
  ink: "#000000",
  inkMuted: "#333333",
  inkSubtle: "#555555",
  brand: "#000000",
  brandHover: "#000000",
  onBrand: "#ffffff",
  brandSoft: "#ececec",
  brandInk: "#000000",
  tileFrom: "#000000",
  tileTo: "#000000",
  glow: "#00000000",
  reward1: "#000000",
  reward2: "#000000",
  reward3: "#000000",
  onReward: "#ffffff",
  success: "#000000",
  successSoft: "#ececec",
  danger: "#000000",
  dangerSoft: "#ececec",
  warning: "#000000",
  warningSoft: "#ececec",
  focus: "#000000",
  onSection: "#ffffff",
  sectionPractice: "#000000",
  sectionSheets: "#000000",
  sectionStories: "#000000",
  sectionVocab: "#000000",
  sectionNotes: "#000000",
  barFrom: "#ffffff",
  barTo: "#ffffff",
  barHighlight: "#ffffff00",
  tabsTrack: "#ffffff",
  tabsActiveFrom: "#ececec",
  tabsActiveTo: "#ececec",
  tabsActiveBorder: "#000000",
  dockFrom: "#ffffff",
  dockTo: "#ffffff",
  dockBorder: "#000000",
  dockHighlight: "#ffffff00",
  dockShadow: "#00000000",
  glassSheen: "#ffffff00",
  glassEdge: "#ffffff00",
  scrim: "#ffffff00",
};

/** E-ink, dark: white on black (Boox and others offer it). */
const einkDark: ColorTokens = {
  ...einkLight,
  bg: "#000000",
  surface: "#000000",
  surfaceRaised: "#000000",
  surfaceSunken: "#262626",
  border: "#737373",
  borderStrong: "#bfbfbf",
  borderControl: "#ffffff",
  ink: "#ffffff",
  inkMuted: "#cccccc",
  inkSubtle: "#aaaaaa",
  brand: "#ffffff",
  brandHover: "#ffffff",
  onBrand: "#000000",
  brandSoft: "#262626",
  brandInk: "#ffffff",
  tileFrom: "#ffffff",
  tileTo: "#ffffff",
  reward1: "#ffffff",
  reward2: "#ffffff",
  reward3: "#ffffff",
  onReward: "#000000",
  success: "#ffffff",
  successSoft: "#262626",
  danger: "#ffffff",
  dangerSoft: "#262626",
  warning: "#ffffff",
  warningSoft: "#262626",
  focus: "#ffffff",
  onSection: "#000000",
  sectionPractice: "#ffffff",
  sectionSheets: "#ffffff",
  sectionStories: "#ffffff",
  sectionVocab: "#ffffff",
  sectionNotes: "#ffffff",
  barFrom: "#000000",
  barTo: "#000000",
  tabsTrack: "#000000",
  tabsActiveFrom: "#262626",
  tabsActiveTo: "#262626",
  tabsActiveBorder: "#ffffff",
  dockFrom: "#000000",
  dockTo: "#000000",
  dockBorder: "#ffffff",
  glassSheen: "#00000000",
  glassEdge: "#00000000",
  scrim: "#00000000",
};

export const colors: Record<Display, Record<Scheme, ColorTokens>> = {
  standard: { light: standardLight, dark: standardDark },
  eink: { light: einkLight, dark: einkDark },
};

export const elevation: Record<Display, Record<Scheme, ElevationTokens>> = {
  standard: {
    light: {
      card: "0 1px 2px #0f14200d, 0 2px 8px #0f142008",
      cardHover: "0 2px 4px #0f142010, 0 8px 24px #0f14200f",
      pop: "0 12px 32px #0f14201f, 0 2px 6px #0f142012",
      glass: "0 1px 2px #0f142014",
    },
    dark: {
      card: "inset 0 1px 0 #ffffff0f, 0 1px 2px #00000066",
      cardHover: "inset 0 1px 0 #ffffff17, 0 8px 24px #00000080",
      pop: "inset 0 1px 0 #ffffff17, 0 16px 40px #000000a6",
      glass: "0 1px 2px #0f142014",
    },
  },
  // Raised things get a hairline instead (cards already draw a border).
  eink: {
    light: { card: "none", cardHover: "none", pop: "0 0 0 1px #000000", glass: "none" },
    dark: { card: "none", cardHover: "none", pop: "0 0 0 1px #ffffff", glass: "none" },
  },
};

export const effects: Record<Display, Record<Scheme, EffectTokens>> = {
  standard: {
    light: {
      blurBar: 12,
      blurGlass: 10,
      blurDock: 18,
      blurReaderBar: 6,
      glassFill: 14,
      glassFillHover: 22,
      glassBorder: 34,
      glassIconFill: 15,
      glassIconBorder: 30,
      glassIconLighten: 0,
      peekBlur: 5,
    },
    dark: {
      blurBar: 12,
      blurGlass: 10,
      blurDock: 18,
      blurReaderBar: 6,
      glassFill: 14,
      glassFillHover: 22,
      glassBorder: 34,
      glassIconFill: 24,
      glassIconBorder: 45,
      glassIconLighten: 45,
      peekBlur: 5,
    },
  },
  // Solid, outlined buttons and icons; nothing blurred.
  eink: {
    light: {
      blurBar: 0,
      blurGlass: 0,
      blurDock: 0,
      blurReaderBar: 0,
      glassFill: 0,
      glassFillHover: 8,
      glassBorder: 100,
      glassIconFill: 0,
      glassIconBorder: 100,
      glassIconLighten: 0,
      peekBlur: 0,
    },
    dark: {
      blurBar: 0,
      blurGlass: 0,
      blurDock: 0,
      blurReaderBar: 0,
      glassFill: 0,
      glassFillHover: 15,
      glassBorder: 100,
      glassIconFill: 0,
      glassIconBorder: 100,
      glassIconLighten: 0,
      peekBlur: 0,
    },
  },
};

const standardMotion: MotionTokens = { fast: 150, base: 200, page: 250, feedback: 400, celebrate: 700, pulse: 1200 };
export const motion: Record<Display, MotionTokens> = {
  standard: standardMotion,
  eink: { fast: 0, base: 0, page: 0, feedback: 0, celebrate: 0, pulse: 0 },
};
/** What reduced motion turns every duration into. */
export const reducedMotion: MotionTokens = motion.eink;

export const radii = { chip: 6, control: 10, card: 14, panel: 20, bar: 16 };

export const fonts = {
  sans: ['"Geist Sans"', '"Segoe UI"', "system-ui", "sans-serif"],
  mono: ['"Geist Mono"', "ui-monospace", '"SF Mono"', "Menlo", "monospace"],
  /** Learning content uses the same face as the interface. */
  content: ['"Geist Sans"', '"Segoe UI"', "system-ui", "sans-serif"],
  /** Notes read distinctly from the rest of the app. */
  note: ['"Lato"', "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
};

/** The story reader's own themes (picked in the reader, not by the app scheme). */
export const readerPalettes: { standard: Record<"light" | "sepia" | "dark", ReaderPalette>; eink: Record<Scheme, ReaderPalette> } = {
  standard: {
    light: { bg: "255 255 255", fg: "30 41 59", muted: "100 116 139", rule: "226 232 240", mark: "37 99 235", vocab: "14 165 233" },
    sepia: { bg: "248 241 227", fg: "67 52 34", muted: "128 108 84", rule: "224 209 183", mark: "180 110 20", vocab: "14 165 233" },
    dark: { bg: "18 21 28", fg: "237 240 245", muted: "154 163 178", rule: "44 50 62", mark: "142 197 255", vocab: "14 165 233" },
  },
  eink: {
    light: { bg: "255 255 255", fg: "0 0 0", muted: "64 64 64", rule: "140 140 140", mark: "0 0 0", vocab: "0 0 0" },
    dark: { bg: "0 0 0", fg: "255 255 255", muted: "191 191 191", rule: "115 115 115", mark: "255 255 255", vocab: "255 255 255" },
  },
};

/** Everything one screen needs, for React Native (numbers in px and ms). */
export function nativeTheme(display: Display, scheme: Scheme, opts: { reduceMotion?: boolean } = {}) {
  return {
    display,
    scheme,
    colors: colors[display][scheme],
    elevation: elevation[display][scheme],
    effects: effects[display][scheme],
    motion: opts.reduceMotion ? reducedMotion : motion[display],
    radii,
    fonts,
    reader: display === "eink" ? readerPalettes.eink : readerPalettes.standard,
  };
}
export type NativeTheme = ReturnType<typeof nativeTheme>;

// --- CSS ---------------------------------------------------------------------

const kebab = (s: string) => s.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);

/** One display + scheme as CSS custom-property declarations. */
function cssVars(display: Display, scheme: Scheme, indent: string): string {
  const lines: string[] = [`color-scheme: ${scheme};`];
  for (const [k, v] of Object.entries(colors[display][scheme])) lines.push(`--${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(elevation[display][scheme])) lines.push(`--shadow-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(effects[display][scheme]))
    lines.push(`--${kebab(k)}: ${k.startsWith("blur") || k === "peekBlur" ? `${v}px` : `${v}%`};`);
  const r = display === "eink" ? readerPalettes.eink[scheme] : readerPalettes.standard[scheme];
  for (const [k, v] of Object.entries(r)) lines.push(`--reader-auto-${k}: ${v};`);
  return lines.map((l) => indent + l).join("\n");
}

function motionVars(m: MotionTokens, indent: string): string {
  return Object.entries(m)
    .map(([k, v]) => `${indent}--motion-${kebab(k)}: ${v}ms;`)
    .join("\n");
}

function readerVars(p: ReaderPalette, indent: string): string {
  return Object.entries(p)
    .map(([k, v]) => `${indent}--r-${k}: ${v};`)
    .join("\n");
}

/**
 * The tokens as CSS. Selectors: light by default; dark when the device is
 * (unless data-scheme="light" on <html>) or when data-scheme="dark";
 * data-display="eink" switches to the e-ink set of either scheme.
 */
export function tokensCss(): string {
  const dark = '@media (prefers-color-scheme: dark)';
  const block = (sel: string, body: string) => `${sel} {\n${body}\n}`;
  const inMedia = (media: string, sel: string, body: string) =>
    `${media} {\n  ${sel} {\n${body.replace(/^/gm, "  ")}\n  }\n}`;
  const out = [
    "/* Generated from packages/client/src/tokens.ts by `pnpm --filter @mdb/web tokens`. Don't edit. */",
    "",
    "/* Standard display */",
    block(":root", cssVars("standard", "light", "  ") + "\n" + motionVars(motion.standard, "  ")),
    inMedia(dark, ':root:not([data-scheme="light"])', cssVars("standard", "dark", "  ")),
    block(':root[data-scheme="dark"]', cssVars("standard", "dark", "  ")),
    "",
    "/* E-ink display (monochrome, slow refresh): no motion */",
    block(':root[data-display="eink"]', cssVars("eink", "light", "  ") + "\n" + motionVars(motion.eink, "  ")),
    inMedia(dark, ':root[data-display="eink"]:not([data-scheme="light"])', cssVars("eink", "dark", "  ")),
    block(':root[data-display="eink"][data-scheme="dark"]', cssVars("eink", "dark", "  ")),
    "",
    "/* Paper is white: printing uses the light colours, whatever the screen shows (beats every rule above). */",
    inMedia("@media print", ":root:root:root:root", cssVars("standard", "light", "  ")),
    "",
    "@media (prefers-reduced-motion: reduce) {",
    block("  :root", motionVars(reducedMotion, "    ")).replace(/\n}$/, "\n  }"),
    "}",
    "",
    "/* Story reader themes; \"auto\" follows the app's scheme and display. */",
    block(".reader", readerVars(readerPalettes.standard.light, "  ")),
    block('.reader[data-theme="sepia"]', readerVars(readerPalettes.standard.sepia, "  ")),
    block('.reader[data-theme="dark"]', readerVars(readerPalettes.standard.dark, "  ")),
    block(
      '.reader[data-theme="auto"]',
      (["bg", "fg", "muted", "rule", "mark", "vocab"] as const).map((k) => `  --r-${k}: var(--reader-auto-${k});`).join("\n"),
    ),
    "/* On e-ink, light and sepia are the e-ink light theme; dark the e-ink dark one. */",
    block(':root[data-display="eink"] .reader:not([data-theme="auto"])', readerVars(readerPalettes.eink.light, "  ")),
    block(':root[data-display="eink"] .reader[data-theme="dark"]', readerVars(readerPalettes.eink.dark, "  ")),
    "",
  ];
  return out.join("\n");
}
