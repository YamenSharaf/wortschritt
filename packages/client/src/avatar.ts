/**
 * The account icon, drawn the same on web and app: a mirrored 5×5 pixel
 * pattern from the name (the seed, changed by "Shuffle", picks another one),
 * or the initial as 5×7 pixels; white on a gradient also picked by both.
 * Cool colours only: the warm ones are the reward colours.
 */
export type AvatarStyle = "pattern" | "letter";

export type Avatar = {
  /** Rows of pixels, true = white. 5×5 for a pattern, 5×7 for a letter. */
  cells: boolean[][];
  /** Gradient from the top left to the bottom right. */
  colors: [string, string];
};

export const AVATAR_COLORS: [string, string][] = [
  ["#5aa9f5", "#2b5fb0"],
  ["#2bb3a3", "#0f6f8f"],
  ["#9b7bf0", "#5b3fc4"],
  ["#5cc98a", "#1d7a55"],
  ["#7d8aa3", "#3d4a63"],
  ["#6c8cff", "#3346b8"],
  ["#4fc3d9", "#1f6f9e"],
];

/** FNV-1a: small, stable across platforms. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A 5×5 pattern, mirrored left to right, neither too sparse nor too full nor stripy. */
function pattern(key: string): boolean[][] {
  for (let salt = 0; ; salt++) {
    const h = hash(`${key}#${salt}`);
    const rows = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => ((h >>> (y * 3 + Math.min(x, 4 - x))) & 1) === 1),
    );
    const on = rows.flat().filter(Boolean).length;
    // A shape, not stripes: pixels in most rows and columns.
    const filledRows = rows.filter((r) => r.some(Boolean)).length;
    const filledCols = [0, 1, 2, 3, 4].filter((x) => rows.some((r) => r[x])).length;
    if ((on >= 8 && on <= 17 && filledRows >= 4 && filledCols >= 3) || salt > 40) return rows;
  }
}

// 5×7 capitals, row by row ("#" = on).
const GLYPHS: Record<string, string> = {
  A: ".###. #...# #...# ##### #...# #...# #...#",
  B: "####. #...# #...# ####. #...# #...# ####.",
  C: ".###. #...# #.... #.... #.... #...# .###.",
  D: "####. #...# #...# #...# #...# #...# ####.",
  E: "##### #.... #.... ####. #.... #.... #####",
  F: "##### #.... #.... ####. #.... #.... #....",
  G: ".###. #...# #.... #.### #...# #...# .####",
  H: "#...# #...# #...# ##### #...# #...# #...#",
  I: ".###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.",
  J: "..### ...#. ...#. ...#. ...#. #..#. .##..",
  K: "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
  L: "#.... #.... #.... #.... #.... #.... #####",
  M: "#...# ##.## #.#.# #.#.# #...# #...# #...#",
  N: "#...# #...# ##..# #.#.# #..## #...# #...#",
  O: ".###. #...# #...# #...# #...# #...# .###.",
  P: "####. #...# #...# ####. #.... #.... #....",
  Q: ".###. #...# #...# #...# #.#.# #..#. .##.#",
  R: "####. #...# #...# ####. #.#.. #..#. #...#",
  S: ".#### #.... #.... .###. ....# ....# ####.",
  T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
  U: "#...# #...# #...# #...# #...# #...# .###.",
  V: "#...# #...# #...# #...# #...# .#.#. ..#..",
  W: "#...# #...# #...# #.#.# #.#.# #.#.# .#.#.",
  X: "#...# #...# .#.#. ..#.. .#.#. #...# #...#",
  Y: "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
  Z: "##### ....# ...#. ..#.. .#... #.... #####",
  "?": ".###. #...# ....# ...#. ..#.. ..... ..#..",
};

/** The first letter of a name as 5×7 pixels (accents dropped; "?" when there's none). */
function letter(name: string): boolean[][] {
  const ch = name.normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase();
  return (GLYPHS[ch] ?? GLYPHS["?"]!).split(" ").map((row) => [...row].map((c) => c === "#"));
}

/** The icon for a user: `key` is their username (stable), `name` what's drawn as a letter. */
export function avatarFor(o: { key: string; name?: string; style?: AvatarStyle; seed?: number }): Avatar {
  const id = `${o.key.toLowerCase()}:${o.seed ?? 0}`;
  return {
    cells: o.style === "letter" ? letter(o.name || o.key) : pattern(id),
    colors: AVATAR_COLORS[hash(id) % AVATAR_COLORS.length]!,
  };
}

/** A new seed for "Shuffle" (any other than the current one). */
export function shuffleSeed(current: number): number {
  let next = current;
  while (next === current) next = Math.floor(Math.random() * 1_000_000);
  return next;
}
