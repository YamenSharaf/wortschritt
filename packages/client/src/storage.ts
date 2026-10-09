/**
 * Small per-device settings (the flashcard direction, the shelf view, …):
 * the web keeps them in localStorage, the app in AsyncStorage, so reads may
 * be async. Not synced: anything that should follow the learner belongs on
 * the server.
 */
export type KeyValueStore = {
  get(key: string): string | null | Promise<string | null>;
  /** null removes the key. */
  set(key: string, value: string | null): void | Promise<void>;
};

/** A store that forgets on reload (tests, or where nothing can be kept). */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void (value === null ? map.delete(key) : map.set(key, value)),
  };
}

/** A per-device preference: where it's kept, its default, and how to read it back. */
export type Preference<T> = {
  key: string;
  fallback: T;
  /** The stored text as a value; undefined if it isn't a valid one. */
  parse: (raw: string) => T | undefined;
};

const oneOf =
  <T extends string>(...values: T[]) =>
  (raw: string) =>
    (values as string[]).includes(raw) ? (raw as T) : undefined;

const between = (min: number, max: number) => (raw: string) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/** The preferences the apps keep (keys as the web has always used them). */
export const preferences = {
  /** Which side of a flashcard shows first. */
  flashcardSide: { key: "mdb-flashcard-dir", fallback: "de", parse: oneOf("de", "en") } as Preference<"de" | "en">,
  /** The bookshelf as covers or a list. */
  shelfView: { key: "mdb.shelfView", fallback: "covers", parse: oneOf("covers", "list") } as Preference<"covers" | "list">,
  /** Light or dark: the device's setting, or a fixed one. */
  colorScheme: { key: "mdb-scheme", fallback: "system", parse: oneOf("system", "light", "dark") } as Preference<
    "system" | "light" | "dark"
  >,
  /** An e-ink screen (monochrome, slow refresh): plain styles, nothing moves. */
  display: { key: "mdb-display", fallback: "standard", parse: oneOf("standard", "eink") } as Preference<"standard" | "eink">,
  /** The note text size, in px. */
  noteFontSize: { key: "mdb-note-fontsize", fallback: 16, parse: between(12, 26) } as Preference<number>,
};
export const NOTE_FONT_SIZE = { min: 12, max: 26 };
