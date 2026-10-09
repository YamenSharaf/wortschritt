import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type PressableProps } from "react-native";
import { font, useTheme } from "@/lib/theme";
import { tint } from "./color";
import { Text } from "./Text";

type Kind = "primary" | "secondary" | "ghost";

/**
 * A button: primary is glass (a tint of the brand colour; on e-ink a solid,
 * outlined one, from the effect tokens), secondary is outlined, ghost is bare.
 */
export function Button({
  kind = "secondary",
  label,
  icon,
  busy,
  disabled,
  ...props
}: PressableProps & { kind?: Kind; label: string; icon?: ReactNode; busy?: boolean }) {
  const { colors, effects, radii, elevation } = useTheme();
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      {...props}
      style={({ pressed }) => [
        {
          minHeight: 44,
          paddingHorizontal: 16,
          borderRadius: radii.control,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: off ? 0.45 : 1,
        },
        kind === "primary" && {
          backgroundColor: tint(colors.brand, pressed ? effects.glassFillHover : effects.glassFill),
          borderWidth: 1,
          borderColor: tint(colors.brand, effects.glassBorder),
          boxShadow: elevation.glass === "none" ? undefined : elevation.glass,
        },
        kind === "secondary" && {
          backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
          borderWidth: 1,
          borderColor: colors.borderControl,
        },
        kind === "ghost" && { backgroundColor: pressed ? colors.surfaceSunken : "transparent" },
      ]}
    >
      {busy ? <ActivityIndicator color={colors.brandInk} /> : icon ? <View>{icon}</View> : null}
      <Text
        style={{
          fontFamily: font.medium,
          fontSize: 15,
          color: kind === "primary" ? colors.brandInk : kind === "ghost" ? colors.inkMuted : colors.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
