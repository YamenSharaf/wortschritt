import { View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { useTheme } from "@/lib/theme";
import { tint } from "./color";
import { Icon } from "./icons";

/** A section's icon on a small tile of its colour (plain on e-ink). */
export function IconTile({ icon, color, size = 36 }: { icon: LucideIcon; color: string; size?: number }) {
  const { radii, elevation } = useTheme();
  const flat = elevation.glass === "none";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radii.control,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: flat ? "transparent" : tint(color, 14),
        borderWidth: flat ? 1 : 0,
        borderColor: color,
      }}
    >
      <Icon icon={icon} size={Math.round(size * 0.52)} color={color} />
    </View>
  );
}
