/** @type {import('tailwindcss').Config} */
// Colours, fonts, radii and shadows come from the Wortschritt design system
// (CSS variables in src/index.css). Light and dark follow the device setting.
const v = (name) => `var(--${name})`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  // hover: styles only where something can hover (no "stuck" hover after a tap).
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        // Cool neutrals tuned to the design system; existing slate-* classes
        // pick these up, so screens not yet restyled still match.
        slate: {
          50: "#f6f7fa",
          100: "#eef1f6",
          200: "#e3e7ee",
          300: "#c9d0db",
          400: "#8d96a7",
          500: "#646d80",
          600: "#4b5468",
          700: "#2c323e",
          800: "#1e222c",
          900: "#12151c",
          950: "#0b0d12",
        },
        bg: v("bg"),
        surface: { DEFAULT: v("surface"), raised: v("surface-raised"), sunken: v("surface-sunken") },
        line: { DEFAULT: v("border"), strong: v("border-strong"), control: v("border-control") },
        ink: { DEFAULT: v("ink"), muted: v("ink-muted"), subtle: v("ink-subtle") },
        brand: {
          DEFAULT: v("brand"),
          hover: v("brand-hover"),
          on: v("on-brand"),
          soft: v("brand-soft"),
          ink: v("brand-ink"),
        },
        // Older name for the brand colour, still used across screens.
        accent: v("brand"),
        "accent-foreground": v("on-brand"),
        success: { DEFAULT: v("success"), soft: v("success-soft") },
        warning: { DEFAULT: v("warning"), soft: v("warning-soft") },
        danger: { DEFAULT: v("danger"), soft: v("danger-soft") },
        reward: { 1: v("reward-1"), 2: v("reward-2"), 3: v("reward-3"), on: v("on-reward") },
        section: {
          practice: v("section-practice"),
          sheets: v("section-sheets"),
          stories: v("section-stories"),
          vocab: v("section-vocab"),
          notes: v("section-notes"),
          on: v("on-section"),
        },
        focus: v("focus"),
      },
      fontFamily: {
        sans: ['"Geist Sans"', '"Segoe UI"', "system-ui", "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", '"SF Mono"', "Menlo", "monospace"],
        // Learning content uses the same face as the interface.
        content: ['"Geist Sans"', '"Segoe UI"', "system-ui", "sans-serif"],
        // Notes use Lato so they read distinctly from the rest of the app.
        note: ['"Lato"', "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
      borderRadius: {
        chip: "6px",
        control: "10px",
        card: "14px",
        panel: "20px",
      },
      boxShadow: {
        card: v("shadow-card"),
        "card-hover": v("shadow-card-hover"),
        pop: v("shadow-pop"),
      },
    },
  },
  plugins: [],
};
