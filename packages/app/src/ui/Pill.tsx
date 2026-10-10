import { View } from "react-native";
import { font, useTheme } from "@/lib/theme";
import { Text } from "./Text";

/** A small label: a level, a length, a status. */
export function Pill({ text, tone }: { text: string; tone?: "success" | "brand" }) {
  const { colors } = useTheme();
  const bg = tone === "success" ? colors.successSoft : tone === "brand" ? colors.brandSoft : colors.surfaceSunken;
  const fg = tone === "success" ? colors.success : tone === "brand" ? colors.brandInk : colors.inkMuted;
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: bg }}>
      <Text style={{ fontSize: 12, fontFamily: font.medium, color: fg }}>{text}</Text>
    </View>
  );
}
