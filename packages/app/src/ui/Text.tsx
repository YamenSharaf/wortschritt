import { Text as RNText, type TextProps } from "react-native";
import { font, useTheme } from "@/lib/theme";

type Variant = "title" | "heading" | "body" | "muted" | "subtle" | "eyebrow" | "number";

/** Text in the design system's type scale and colours. */
export function Text({ variant = "body", style, ...props }: TextProps & { variant?: Variant }) {
  const { colors } = useTheme();
  const v = {
    title: { fontFamily: font.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.56, color: colors.ink },
    heading: { fontFamily: font.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.2, color: colors.ink },
    body: { fontFamily: font.regular, fontSize: 16, lineHeight: 24, color: colors.ink },
    muted: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: colors.inkMuted },
    subtle: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: colors.inkSubtle },
    eyebrow: { fontFamily: font.semibold, fontSize: 11, lineHeight: 16, letterSpacing: 0.9, color: colors.inkSubtle, textTransform: "uppercase" as const },
    number: { fontFamily: font.mono, fontSize: 15, lineHeight: 20, color: colors.ink, fontVariant: ["tabular-nums" as const] },
  }[variant];
  return <RNText {...props} style={[v, style]} />;
}
