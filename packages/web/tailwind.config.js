/** @type {import('tailwindcss').Config} */
// Colours, fonts, radii, shadows and motion come from the design tokens
// (packages/client/src/tokens.ts): colours and shadows as the CSS variables in
// src/tokens.css, so they follow the scheme (light/dark) and display (e-ink).
import { fonts, radii } from "@mdb/client/tokens";

const v = (name) => `var(--${name})`;
const px = (n) => `${n}px`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
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
      fontFamily: fonts,
      borderRadius: {
        chip: px(radii.chip),
        control: px(radii.control),
        card: px(radii.card),
        panel: px(radii.panel),
      },
      boxShadow: {
        card: v("shadow-card"),
        "card-hover": v("shadow-card-hover"),
        pop: v("shadow-pop"),
      },
      // Transitions last --motion-fast: 0 on e-ink and with reduced motion.
      transitionDuration: { DEFAULT: v("motion-fast") },
    },
  },
  plugins: [],
};
