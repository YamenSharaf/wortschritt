/** `hex` (#rrggbb or #rrggbbaa) at `percent`% opacity — CSS's color-mix(…, transparent). */
export function tint(hex: string, percent: number): string {
  const h = hex.replace("#", "");
  const base = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  const a = Math.round(base * (percent / 100) * 255);
  return `#${h.slice(0, 6)}${a.toString(16).padStart(2, "0")}`;
}
