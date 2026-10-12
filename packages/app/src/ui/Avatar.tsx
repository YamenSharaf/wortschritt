import { useId } from "react";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Avatar as AvatarData } from "@mdb/client";
import { useTheme } from "@/lib/theme";

/**
 * The account icon, as on the web (components/Avatar): white pixels (a
 * pattern, or the initial) on a gradient rounded square; `dot` marks a problem.
 */
export function Avatar({ avatar, size = 36, dot }: { avatar: AvatarData; size?: number; dot?: string }) {
  const id = useId().replace(/:/g, "");
  const { colors } = useTheme();
  const rows = avatar.cells.length;
  const cols = avatar.cells[0]?.length ?? 5;
  const unit = (rows === 5 ? 21 : 18) / Math.max(rows, cols);
  const x0 = (36 - cols * unit) / 2;
  const y0 = (36 - rows * unit) / 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36">
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={avatar.colors[0]} />
          <Stop offset="1" stopColor={avatar.colors[1]} />
        </LinearGradient>
      </Defs>
      <Rect width="36" height="36" rx="10" fill={`url(#${id}g)`} />
      <Rect x=".5" y=".5" width="35" height="35" rx="9.5" fill="none" stroke="#ffffff" strokeOpacity={0.25} />
      {avatar.cells.flatMap((row, y) =>
        row.map((on, x) =>
          on ? <Rect key={`${x}-${y}`} x={x0 + x * unit} y={y0 + y * unit} width={unit + 0.3} height={unit + 0.3} fill="#fff" /> : null,
        ),
      )}
      {dot ? <Circle cx="31" cy="31" r="4.5" fill={dot} stroke={colors.bg} strokeWidth={2} /> : null}
    </Svg>
  );
}
