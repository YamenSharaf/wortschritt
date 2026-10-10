import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { font, useTheme } from "@/lib/theme";
import { Text } from "./Text";

/** A selectable rounded chip (a group, a filter); `dashed` for "add one". */
export function Chip({
  label,
  on,
  onPress,
  onLongPress,
  dashed,
  icon,
  a11y,
}: {
  label: string;
  on?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  dashed?: boolean;
  icon?: ReactNode;
  a11y?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      accessibilityLabel={a11y ?? label}
      hitSlop={4}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        minHeight: 34,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderStyle: dashed ? "dashed" : "solid",
        borderColor: on ? "transparent" : colors.borderControl,
        backgroundColor: on ? colors.brandSoft : "transparent",
      }}
    >
      {icon}
      <Text style={{ fontSize: 13, fontFamily: font.medium, color: on ? colors.brandInk : colors.inkMuted }}>{label}</Text>
    </Pressable>
  );
}
