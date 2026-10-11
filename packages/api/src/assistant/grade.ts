import type { FastifyBaseLogger } from "fastify";
import { collectCompletion } from "./client";
import { getAiChain } from "./config";
import { buildGradeMessages, buildTranslateGradeMessages } from "./prompts";

/** Read a verdict from the model's reply (JSON, or a best guess from prose). */
export function parseVerdict(content: string): { correct: boolean; feedback: string } {
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const o = JSON.parse(match[0]) as { correct?: unknown; feedback?: unknown };
      if (typeof o.correct === "boolean") {
        return { correct: o.correct, feedback: String(o.feedback ?? "") };
      }
    } catch {
      /* fall through to heuristic */
    }
  }
  const correct =
    /"?correct"?\s*[:=]\s*true/i.test(content) ||
    (/\brichtig\b/i.test(content) && !/falsch|nicht richtig/i.test(content));
  return { correct, feedback: content.slice(0, 200).trim() };
}

/**
 * Ask the learner's AI tutor to judge a free-text answer the item's own rules
 * didn't accept. Null when the tutor isn't set up or didn't answer: the
 * caller then applies the no-tutor rule.
 */
export async function judgeAnswer(
  userId: number,
  input: Parameters<typeof buildGradeMessages>[0],
  log?: FastifyBaseLogger,
): Promise<{ correct: boolean; feedback: string } | null> {
  const content = await ask(userId, buildGradeMessages(input), log);
  return content === null ? null : parseVerdict(content);
}

export type TranslationVerdict = { verdict: "correct" | "almost" | "wrong"; corrected: string; feedback: string };

/** Read a translation verdict; null when the reply can't be understood. */
export function parseTranslationVerdict(content: string): TranslationVerdict | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as { verdict?: unknown; corrected?: unknown; feedback?: unknown };
    if (o.verdict !== "correct" && o.verdict !== "almost" && o.verdict !== "wrong") return null;
    return { verdict: o.verdict, corrected: typeof o.corrected === "string" ? o.corrected.trim() : "", feedback: String(o.feedback ?? "").trim() };
  } catch {
    return null;
  }
}

/** Ask the learner's AI tutor to judge a translation. Null when there's no tutor or no usable answer. */
export async function judgeTranslation(
  userId: number,
  input: Parameters<typeof buildTranslateGradeMessages>[0],
  log?: FastifyBaseLogger,
): Promise<TranslationVerdict | null> {
  const content = await ask(userId, buildTranslateGradeMessages(input), log);
  return content === null ? null : parseTranslationVerdict(content);
}

async function ask(userId: number, { system, user }: { system: string; user: string }, log?: FastifyBaseLogger): Promise<string | null> {
  const ai = getAiChain(userId);
  if (!ai) return null;
  try {
    const content = await collectCompletion(
      ai,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        temperature: 0,
        maxTokens: 256,
        onFallback: (failed, error) =>
          log?.warn({ provider: failed.provider, model: failed.model, error: error.publicMessage }, "AI model failed, trying the next one"),
      },
    );
    return content;
  } catch (err) {
    log?.warn({ err: err instanceof Error ? err.message : String(err) }, "grade: the AI tutor didn't answer");
    return null;
  }
}
