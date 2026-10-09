import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme";

/** A static card: hairline border, soft shadow (none on e-ink). */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { colors, radii, elevation } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radii.card,
          boxShadow: elevation.card === "none" ? undefined : elevation.card,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
