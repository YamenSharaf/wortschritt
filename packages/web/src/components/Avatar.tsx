import { useId } from "react";
import type { Avatar as AvatarData } from "@mdb/client";

/**
 * The account icon: white pixels (a pattern, or the initial) on a gradient
 * rounded square. `dot` marks something wrong (e.g. a sync error).
 */
export function Avatar({ avatar, size = 36, dot }: { avatar: AvatarData; size?: number; dot?: string }) {
  const id = useId();
  const rows = avatar.cells.length;
  const cols = avatar.cells[0]?.length ?? 5;
  // Pixels fill the middle: 60% of the width for a pattern, a little less for a letter.
  const unit = (rows === 5 ? 21 : 18) / Math.max(rows, cols);
  const x0 = (36 - cols * unit) / 2;
  const y0 = (36 - rows * unit) / 2;
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden className="block shrink-0">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={avatar.colors[0]} />
          <stop offset="1" stopColor={avatar.colors[1]} />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="10" fill={`url(#${id}g)`} />
      <rect x=".5" y=".5" width="35" height="35" rx="9.5" fill="none" stroke="#ffffff" strokeOpacity=".25" />
      {avatar.cells.flatMap((row, y) =>
        row.map((on, x) =>
          on ? <rect key={`${x}-${y}`} x={x0 + x * unit} y={y0 + y * unit} width={unit + 0.3} height={unit + 0.3} fill="#fff" /> : null,
        ),
      )}
      {dot && <circle cx="31" cy="31" r="4.5" fill={dot} stroke="var(--bg)" strokeWidth="2" />}
    </svg>
  );
}
