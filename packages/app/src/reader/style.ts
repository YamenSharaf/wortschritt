import type { ReaderSettings } from "@mdb/shared";
import { readerPalettes, type ReaderPalette } from "@mdb/client/tokens";
import { rgbHex } from "./text";

/** Each reader font as loaded (regular and title faces): Android picks faces by name, not weight. */
export const READER_FONTS: Record<ReaderSettings["font"], { label: string; regular: string; title: string }> = {
  serif: { label: "Serif", regular: "Literata_400Regular", title: "Literata_600SemiBold" },
  sans: { label: "Sans", regular: "Lato_400Regular", title: "Lato_700Bold" },
  readable: { label: "Readable", regular: "AtkinsonHyperlegible_400Regular", title: "AtkinsonHyperlegible_700Bold" },
  libron: { label: "Libron", regular: "Libron-Regular", title: "Libron-Bold" },
};

/** As on the web (multiples of the size). */
export const LINE_HEIGHTS: Record<ReaderSettings["lineHeight"], number> = { compact: 1.5, normal: 1.75, relaxed: 2 };

/** The text column's widest (px), for tablets; phones use the whole width. */
export const WIDTHS: Record<ReaderSettings["width"], number> = { narrow: 512, medium: 608, wide: 736 };

/** The reader's colours as hex: the theme picked in the reader, or "auto" (the app's scheme). */
export type ReaderColors = { bg: string; fg: string; muted: string; rule: string; mark: string; vocab: string };

export function readerColors(theme: ReaderSettings["theme"], display: "standard" | "eink", scheme: "light" | "dark"): ReaderColors {
  let p: ReaderPalette;
  if (display === "eink") {
    // Greys only: e-ink has a light and a dark page (sepia reads as light).
    const dark = theme === "dark" || (theme === "auto" && scheme === "dark");
    p = readerPalettes.eink[dark ? "dark" : "light"];
  } else {
    p = readerPalettes.standard[theme === "auto" ? scheme : theme];
  }
  return { bg: rgbHex(p.bg), fg: rgbHex(p.fg), muted: rgbHex(p.muted), rule: rgbHex(p.rule), mark: rgbHex(p.mark), vocab: rgbHex(p.vocab) };
}
