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

/**
 * Make sure a story's audio exists: start it if needed, then poll until it's
 * ready (reporting clips made so far). Throws with the server's reason.
 */
export async function prepareStoryAudio(
  api: Pick<Api, "startStoryAudio" | "storyAudio">,
  id: string,
  opts: { onProgress?: (done: number, total: number) => void; isCancelled?: () => boolean; interval?: number } = {},
): Promise<ReadyAudio> {
  let s = await api.storyAudio(id);
  if (s.state !== "ready") s = await api.startStoryAudio(id);
  while (s.state === "building") {
    opts.onProgress?.(s.done, s.total);
    await new Promise<void>((r) => timers.setTimeout(r, opts.interval ?? 1000));
    if (opts.isCancelled?.()) throw new Error("cancelled");
    s = await api.storyAudio(id);
  }
  if (s.state !== "ready" || !s.key) throw new Error(s.error ?? "Couldn't make the audio.");
  return s as ReadyAudio;
}
