import {
  slugify,
  STORY_LENGTHS,
  story as storySchema,
  type ExerciseItem,
  type GenerateStoryBody,
  type Story,
  type StoryContext,
  type StoryContextOptions,
  type StoryView,
} from "@mdb/shared";
import { streamCompletion, type OnFallback } from "../assistant/client";
import type { AiConfig } from "../assistant/config";
import { buildStoryMessages, buildStoryRepair } from "../assistant/prompts";
import { latestRunsPerSet } from "./activity";
import { getMistakes } from "./history";
import { getSettings } from "./settings";
import { getStory, saveStory } from "./stories";
import { listVocab } from "./vocab";

/**
 * Stories written by the learner's AI from a free-text request, keeping in
 * mind what they chose: recent mistakes, saved words, recent topics. The
 * context is built here once, both for the preview and for the prompt, so
 * the learner sees exactly what's sent.
 */

const MAX_MISTAKES = 8;
const MAX_WORDS = 30;
const MAX_TOPICS = 5;

/** A mistake as one line for the prompt: the task and its right answer. */
export function itemSummary(item: ExerciseItem): { task: string; answer: string } {
  const first = (a: { accept: string[] }) => a.accept[0] ?? "";
  switch (item.type) {
    case "multiple_choice":
      return { task: item.prompt, answer: item.choices[item.answerIndex] ?? "" };
    case "cloze":
      return {
        task: item.text.replace(/\{\{\s*[^}]+?\s*\}\}/g, "___"),
        answer: item.blanks.map((b) => first(b.answer)).join(" / "),
      };
    case "flashcard":
      return { task: item.front, answer: item.back };
    case "sentence_build":
      return { task: item.instructions ?? item.hint ?? "Build the sentence", answer: first(item.answer) };
    case "transform":
      return { task: `${item.instructions ?? "Rewrite"}: ${item.source}`, answer: first(item.answer) };
    case "true_false":
      return {
        task: item.statement,
        answer: item.correct ? "richtig" : `falsch${item.correction ? ` (${item.correction})` : ""}`,
      };
    case "conjugation_table":
      return {
        task: item.instructions ?? `Konjugation: ${item.columns.map((c) => c.header).join(", ")}`,
        answer: item.columns
          .map((c) => `${c.header}: ${item.rows.map((r, i) => `${r} ${c.answers[i] ?? ""}`).join(", ")}`)
          .join("; "),
      };
  }
}

export function buildStoryContext(userId: number, opts: StoryContextOptions): StoryContext {
  const level = getSettings(userId).level;

  const mistakes = opts.mistakes
    ? getMistakes(userId, { limit: MAX_MISTAKES * 2 })
        .filter((m) => m.item)
        .slice(0, MAX_MISTAKES)
        .map((m) => ({ source: m.setTitle ?? m.setId, ...itemSummary(m.item!), response: m.responses[0] ?? null }))
    : [];

  // Words still being learned first (last flashcard missed, or more misses
  // than hits), then the newest.
  const weak = (s: { known: number; missed: number; lastResult: boolean | null } | null) =>
    s ? (s.lastResult === false ? 2 : s.missed > s.known ? 1 : 0) : 0;
  const words = opts.vocab
    ? listVocab(userId)
        .sort((a, b) => weak(b.stats) - weak(a.stats) || b.createdAt - a.createdAt)
        .slice(0, MAX_WORDS)
        .map((w) => w.display)
    : [];

  const topics = opts.topics
    ? latestRunsPerSet(userId, 20)
        .filter((r) => !r.setId.startsWith("story:"))
        .slice(0, MAX_TOPICS)
        .map((r) => r.setTitle)
    : [];

  return { level, mistakes, words, topics };
}

/** The first {...} block of a reply (models sometimes add fences or prose). */
function extractJson(content: string): unknown {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function problems(candidate: unknown): string[] {
  if (candidate === null) return ["The reply contained no valid JSON object."];
  const r = storySchema.safeParse(candidate);
  return r.success ? [] : r.error.issues.slice(0, 15).map((i) => `${i.path.join(".") || "(story)"}: ${i.message}`);
}

/** A free story id for this learner, from the title. */
function freeId(userId: number, title: string): string {
  const base = slugify(title);
  if (!getStory(userId, base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base.slice(0, 74)}-${n}`;
    if (!getStory(userId, id)) return id;
  }
}

export class StoryGenerationError extends Error {}

export type GenerationProgress =
  | { phase: "writing"; chars: number }
  | { phase: "checking" }
  | { phase: "fixing"; problems: number };

/**
 * Write, check and save a story. The id and level are the server's (a free
 * slug of the title, the requested level). Invalid JSON gets one repair
 * round; if only the questions are still broken, the story is saved without
 * them (`questionsDropped`).
 */
export async function generateStory(
  userId: number,
  ai: AiConfig[],
  request: GenerateStoryBody,
  opts: { signal?: AbortSignal; onProgress?: (p: GenerationProgress) => void; onFallback?: OnFallback } = {},
): Promise<{ view: StoryView; questionsDropped: boolean }> {
  const level = request.level ?? getSettings(userId).level;
  const context = buildStoryContext(userId, request.context);
  const { system, user } = buildStoryMessages({ request, level, context });
  const maxTokens = Math.min(8192, 1500 + STORY_LENGTHS[request.length] * 4 + request.questions * 300);

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  async function complete(): Promise<string> {
    let content = "";
    let last = 0;
    for await (const token of streamCompletion(ai, messages, {
      temperature: 0.8,
      maxTokens,
      signal: opts.signal,
      onFallback: opts.onFallback,
    })) {
      content += token;
      if (Date.now() - last > 700) {
        last = Date.now();
        opts.onProgress?.({ phase: "writing", chars: content.length });
      }
    }
    return content;
  }

  // The server decides id and level; the model's own values are ignored.
  const normalize = (raw: unknown): unknown =>
    raw && typeof raw === "object"
      ? { ...(raw as object), id: "draft", level, schemaVersion: 1 }
      : raw;

  let content = await complete();
  opts.onProgress?.({ phase: "checking" });
  let candidate = normalize(extractJson(content));
  let found = problems(candidate);
  if (found.length) {
    opts.onProgress?.({ phase: "fixing", problems: found.length });
    messages.push({ role: "assistant", content }, { role: "user", content: buildStoryRepair(found) });
    content = await complete();
    opts.onProgress?.({ phase: "checking" });
    candidate = normalize(extractJson(content));
    found = problems(candidate);
  }

  let story: Story;
  let questionsDropped = false;
  if (!found.length) {
    story = storySchema.parse(candidate);
  } else if (
    candidate &&
    typeof candidate === "object" &&
    problems({ ...(candidate as object), questions: [] }).length === 0
  ) {
    story = storySchema.parse({ ...(candidate as object), questions: [] });
    questionsDropped = true;
  } else {
    throw new StoryGenerationError(`The AI's story didn't pass the checks (${found[0]}). Try again.`);
  }

  story = { ...story, id: freeId(userId, story.title) };
  const res = saveStory(userId, story);
  if (!res.ok) throw new StoryGenerationError(res.error);
  return { view: res.view, questionsDropped };
}
