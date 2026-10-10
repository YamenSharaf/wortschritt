import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme";

/** A static card: hairline border, soft shadow (none on e-ink). */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { colors, radii, elevation, scheme } = useTheme();
  // Light mode: a faint bright top edge over the shadow (dark mode's has one already).
  const shadow = elevation.card === "none" ? undefined : scheme === "light" ? `inset 0 1px 0 #ffffffcc, ${elevation.card}` : elevation.card;
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radii.card,
          boxShadow: shadow,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
