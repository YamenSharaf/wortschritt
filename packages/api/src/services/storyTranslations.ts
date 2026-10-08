import { and, eq } from "drizzle-orm";
import { plainText, splitSentences, storyParagraphs, type StoryTranslations } from "@mdb/shared";
import { collectCompletion, type OnFallback } from "../assistant/client";
import type { AiConfig } from "../assistant/config";
import { buildSentenceTranslation } from "../assistant/prompts";
import { db, schema } from "../db/client";
import { getStory, paragraphHash } from "./stories";

/**
 * Line-by-line English for a learner's story. Stored per paragraph, keyed by
 * a hash of its text, so edits only re-translate what changed. A paragraph's
 * lines are one per sentence (as `splitSentences` cuts it) or, when the
 * sentences couldn't be matched, a single line for the whole paragraph.
 */

const hashOf = paragraphHash;
const key = (userId: number, storyId: string) =>
  and(eq(schema.storyTranslations.userId, userId), eq(schema.storyTranslations.storyId, storyId));

export class TranslationError extends Error {}

/** The story's paragraphs with their sentences and any stored lines. */
export function getStoryTranslations(userId: number, storyId: string): StoryTranslations | null {
  const view = getStory(userId, storyId);
  if (!view) return null;
  const stored = new Map(
    db
      .select()
      .from(schema.storyTranslations)
      .where(key(userId, storyId))
      .all()
      .map((r) => [r.paragraphHash, r.lines]),
  );
  return {
    paragraphs: storyParagraphs(view.story.body).map((block, index) => ({
      index,
      sentences: splitSentences(block).map(plainText),
      lines: stored.get(hashOf(block)) ?? null,
    })),
  };
}

function store(userId: number, storyId: string, block: string, lines: string[]) {
  db.insert(schema.storyTranslations)
    .values({ userId, storyId, paragraphHash: hashOf(block), lines })
    .onConflictDoUpdate({
      target: [schema.storyTranslations.userId, schema.storyTranslations.storyId, schema.storyTranslations.paragraphHash],
      set: { lines },
    })
    .run();
}

/** Save given lines (e.g. from an agent); each paragraph needs one line per sentence, or one in total. */
export function saveStoryTranslations(
  userId: number,
  storyId: string,
  items: { index: number; lines: string[] }[],
): { ok: true; view: StoryTranslations } | { ok: false; status: 400 | 404; error: string } {
  const view = getStory(userId, storyId);
  if (!view) return { ok: false, status: 404, error: "no such story" };
  const blocks = storyParagraphs(view.story.body);
  for (const { index, lines } of items) {
    const block = blocks[index];
    if (block === undefined) {
      return { ok: false, status: 400, error: `paragraph ${index} doesn't exist (the story has ${blocks.length})` };
    }
    const n = splitSentences(block).length;
    if (lines.length !== n && lines.length !== 1) {
      return {
        ok: false,
        status: 400,
        error: `paragraph ${index} has ${n} sentences but got ${lines.length} lines (send ${n}, or 1 for the whole paragraph)`,
      };
    }
  }
  for (const { index, lines } of items) store(userId, storyId, blocks[index]!, lines.map((l) => l.trim()));
  return { ok: true, view: getStoryTranslations(userId, storyId)! };
}

/** Translate the given paragraphs that have no lines yet, with the learner's AI. */
export async function translateStoryParagraphs(
  userId: number,
  storyId: string,
  ai: AiConfig[],
  indices: number[],
  opts: { onFallback?: OnFallback } = {},
): Promise<StoryTranslations | null> {
  const view = getStory(userId, storyId);
  const current = getStoryTranslations(userId, storyId);
  if (!view || !current) return null;
  const blocks = storyParagraphs(view.story.body);
  const todo = [...new Set(indices)].filter((i) => current.paragraphs[i] && !current.paragraphs[i]!.lines);
  if (!todo.length) return current;

  const sentences = todo.map((i) => current.paragraphs[i]!.sentences);
  const { system, user } = buildSentenceTranslation({ level: view.story.level, paragraphs: sentences });
  const words = sentences.flat().join(" ").split(/\s+/).length;
  const content = await collectCompletion(
    ai,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: Math.min(6000, 400 + words * 4), onFallback: opts.onFallback },
  );
  let result: unknown;
  try {
    result = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? "");
  } catch {
    result = null;
  }
  const paragraphs = (result as { paragraphs?: unknown })?.paragraphs;
  if (!Array.isArray(paragraphs)) throw new TranslationError("The AI's translation couldn't be read. Try again.");

  todo.forEach((index, k) => {
    const raw = paragraphs[k];
    if (!Array.isArray(raw)) return;
    const lines = raw.filter((l): l is string => typeof l === "string" && l.trim() !== "").map((l) => l.trim());
    if (!lines.length) return;
    // Matched one to one, or else kept as one line for the paragraph.
    store(userId, storyId, blocks[index]!, lines.length === sentences[k]!.length ? lines : [lines.join(" ")]);
  });
  return getStoryTranslations(userId, storyId);
}
