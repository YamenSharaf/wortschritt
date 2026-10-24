import type { StoryAudio } from "@mdb/shared";
import type { Api } from "./api";
import { timers } from "./timers";

/**
 * Listening to a story like an audiobook, the parts web and app share: having
 * the server make the audio (and waiting for it) and following along.
 */

/** The paragraph being read at `t` seconds: the last one starting at or before it. */
export function paragraphAt(starts: number[], t: number): number {
  let at = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i]! <= t + 0.05) at = i;
  return at;
}

export type ReadyAudio = StoryAudio & { state: "ready"; key: string };

/** How far making a story's audio has got; `retryAt` (unix seconds) while it waits for the voice's limit. */
export type AudioProgress = { done: number; total: number; retryAt: number | null };

/** The progress as a line for the listen bar. */
export function audioProgressText(p: AudioProgress | null, now = Date.now()): string {
  if (!p) return "Preparing the audio…";
  const parts = p.total ? ` · ${p.done} of ${p.total}` : "";
  if (p.retryAt === null) return `Preparing the audio…${parts}`;
  const minutes = Math.max(1, Math.round((p.retryAt * 1000 - now) / 60_000));
  return `Waiting for the voice's limit${parts} · carries on by itself (next try in ${minutes} min)`;
}

/**
 * Make sure a story's audio exists: start it if needed, then poll until it's
 * ready (reporting progress; slowly while it waits for the voice's limit,
 * which the server carries on with by itself). Throws with the server's reason.
 */
export async function prepareStoryAudio(
  api: Pick<Api, "startStoryAudio" | "storyAudio">,
  id: string,
  opts: { onProgress?: (p: AudioProgress) => void; isCancelled?: () => boolean; interval?: number; waitingInterval?: number } = {},
): Promise<ReadyAudio> {
  let s = await api.storyAudio(id);
  if (s.state !== "ready") s = await api.startStoryAudio(id);
  while (s.state === "building" || s.state === "waiting") {
    const waiting = s.state === "waiting";
    opts.onProgress?.({ done: s.done, total: s.total, retryAt: waiting ? (s.retryAt ?? null) : null });
    await new Promise<void>((r) => timers.setTimeout(r, waiting ? (opts.waitingInterval ?? 30_000) : (opts.interval ?? 1000)));
    if (opts.isCancelled?.()) throw new Error("cancelled");
    s = await api.storyAudio(id);
  }
  if (s.state !== "ready" || !s.key) throw new Error(s.error ?? "Couldn't make the audio.");
  return s as ReadyAudio;
}
