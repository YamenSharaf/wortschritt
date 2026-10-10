import { useRef, type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { BlurTargetView, BlurView } from "expo-blur";
import { useTheme } from "@/lib/theme";
import { Card } from "./Card";

/**
 * A card on frosted glass, as the flashcards: soft colour fields behind,
 * blurred, with a light edge. For the one card a screen leads with (Home);
 * on e-ink (no effects) it's a plain card.
 */
export function GlassCard({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { colors, radii, scheme, elevation } = useTheme();
  const target = useRef<View | null>(null);
  if (elevation.glass === "none") return <Card style={{ borderRadius: radii.panel, ...style }}>{children}</Card>;
  const dark = scheme === "dark";
  const a = dark ? 0.45 : 0.38;
  const blob = (c: string, st: ViewStyle) => <View style={[{ position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: c, opacity: a }, st]} />;
  return (
    <View
      style={[
        {
          borderRadius: radii.panel,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: dark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.8)",
          backgroundColor: colors.surface,
          boxShadow: elevation.cardHover,
        },
        style,
      ]}
    >
      <BlurTargetView ref={target} style={StyleSheet.absoluteFill} pointerEvents="none">
        {blob(colors.brand, { top: -90, left: -60 })}
        {blob(colors.reward2, { top: -40, right: -90 })}
        {blob(colors.success, { bottom: -120, left: 80, width: 200, height: 200 })}
      </BlurTargetView>
      <BlurView
        blurTarget={target}
        intensity={90}
        tint={dark ? "dark" : "light"}
        blurMethod="dimezisBlurViewSdk31Plus"
        style={[StyleSheet.absoluteFill, { backgroundColor: dark ? "rgba(15,20,32,0.35)" : "rgba(255,255,255,0.4)" }]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}
