/**
 * setTimeout and friends exist in browsers and React Native but aren't in the
 * ES libs this package compiles against (no DOM or Node types), so type them.
 */
export type TimerId = number;
export const timers = globalThis as unknown as {
  setTimeout(fn: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId | undefined): void;
  setInterval(fn: () => void, ms: number): TimerId;
  clearInterval(id: TimerId | undefined): void;
};
