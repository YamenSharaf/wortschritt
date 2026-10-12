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

/** Every top-level {…} in a reply (models wrap JSON in prose or code fences, or think aloud first). */
function jsonObjects(content: string): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    for (let j = i; j < content.length; j++) {
      const c = content[j];
      if (inString) {
        if (c === "\\") j++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          out.push(JSON.parse(content.slice(i, j + 1)));
          i = j;
        } catch {
          /* not JSON: keep looking */
        }
        break;
      }
    }
  }
  return out;
}

const VERDICTS: Record<string, TranslationVerdict["verdict"]> = {
  correct: "correct",
  right: "correct",
  almost: "almost",
  "almost correct": "almost",
  "partially correct": "almost",
  "nearly correct": "almost",
  minor: "almost",
  wrong: "wrong",
  incorrect: "wrong",
};

/** Read a translation verdict; null when the reply can't be understood. */
export function parseTranslationVerdict(content: string): TranslationVerdict | null {
  for (const o of jsonObjects(content)) {
    if (!o || typeof o !== "object") continue;
    const r = o as { verdict?: unknown; correct?: unknown; corrected?: unknown; feedback?: unknown };
    const verdict =
      typeof r.verdict === "string" ? VERDICTS[r.verdict.trim().toLowerCase()] : typeof r.correct === "boolean" ? (r.correct ? "correct" : "wrong") : undefined;
    if (!verdict) continue;
    return { verdict, corrected: typeof r.corrected === "string" ? r.corrected.trim() : "", feedback: typeof r.feedback === "string" ? r.feedback.trim() : "" };
  }
  return null;
}

/** Ask the learner's AI tutor to judge a translation. Null when there's no tutor or no usable answer. */
export async function judgeTranslation(
  userId: number,
  input: Parameters<typeof buildTranslateGradeMessages>[0],
  log?: FastifyBaseLogger,
): Promise<TranslationVerdict | null> {
  const content = await ask(userId, buildTranslateGradeMessages(input), log);
  if (content === null) return null;
  const verdict = parseTranslationVerdict(content);
  if (!verdict) log?.warn({ reply: content.slice(0, 400) }, "grade: couldn't read the tutor's translation verdict");
  return verdict;
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
