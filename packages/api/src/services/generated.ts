import type { FastifyBaseLogger } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { exerciseItem, exerciseSet, type ExerciseItem } from "@mdb/shared";
import { aiErrorMessage, collectCompletion } from "../assistant/client";
import { getAiChain } from "../assistant/config";
import { buildGenerateMessages } from "../assistant/prompts";
import { loadExerciseSets } from "../content/loader";
import { db, schema } from "../db/client";
import { forgetInSession } from "./activity";

/**
 * "Generate more": the server writes extra items for a library set with the
 * learner's AI tutor and keeps them for that learner, so they're graded,
 * resumed, synced and listed in mistakes like the set's own items. The shared
 * set itself never changes.
 */

const key = (userId: number, setId: string) =>
  and(eq(schema.generatedItems.userId, userId), eq(schema.generatedItems.setId, setId));

/** This learner's generated items for a set, oldest first. */
export function listGenerated(userId: number, setId: string): ExerciseItem[] {
  return db
    .select({ item: schema.generatedItems.item })
    .from(schema.generatedItems)
    .where(key(userId, setId))
    .orderBy(asc(schema.generatedItems.createdAt), asc(schema.generatedItems.itemId))
    .all()
    .map((r) => r.item);
}

/** Every set this learner has generated items for. */
export function allGenerated(userId: number): Map<string, ExerciseItem[]> {
  const out = new Map<string, ExerciseItem[]>();
  const rows = db
    .select()
    .from(schema.generatedItems)
    .where(eq(schema.generatedItems.userId, userId))
    .orderBy(asc(schema.generatedItems.createdAt), asc(schema.generatedItems.itemId))
    .all();
  for (const r of rows) out.set(r.setId, [...(out.get(r.setId) ?? []), r.item]);
  return out;
}

/** Remove a set's generated items (and their answers from the open session; history keeps them). */
export function removeGenerated(userId: number, setId: string): number {
  const ids = listGenerated(userId, setId).map((i) => i.id);
  forgetInSession(userId, setId, ids);
  return db.delete(schema.generatedItems).where(key(userId, setId)).run().changes;
}

/** Remove one generated item (and its answer from the open session; history keeps it). */
export function removeGeneratedItem(userId: number, setId: string, itemId: string): boolean {
  forgetInSession(userId, setId, [itemId]);
  return db.delete(schema.generatedItems).where(and(key(userId, setId), eq(schema.generatedItems.itemId, itemId))).run().changes > 0;
}

/**
 * Validate one generated item against BOTH the item schema and the structural
 * checks (cloze placeholders, table answer counts) by round-tripping it through
 * a one-item exerciseSet. Returns the clean item or null.
 */
export function validGeneratedItem(raw: unknown, id: string): ExerciseItem | null {
  // The server owns item ids, so inject ours before validating. Otherwise a
  // model that omits "id" (or supplies a non-string one) fails the schema and
  // the item is silently dropped — the whole batch can vanish this way.
  const withId = raw && typeof raw === "object" ? { ...(raw as object), id } : raw;
  const parsed = exerciseItem.safeParse(withId);
  if (!parsed.success) return null;
  const set = exerciseSet.safeParse({ id: "gen", title: "gen", level: "A1", items: [parsed.data] });
  return set.success ? parsed.data : null;
}

export class GenerateError extends Error {
  constructor(
    readonly status: 404 | 502 | 503,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Examples for the tutor: items this learner got wrong in the set first
 * (newest mistakes first), then the set's own first items; three at most.
 */
function samples(userId: number, setId: string, items: ExerciseItem[]): ExerciseItem[] {
  const missed = db
    .select({ itemId: schema.attempts.itemId })
    .from(schema.attempts)
    .where(and(eq(schema.attempts.userId, userId), eq(schema.attempts.setId, setId), eq(schema.attempts.correct, false)))
    .orderBy(desc(schema.attempts.id))
    .all()
    .map((r) => r.itemId);
  const byId = new Map(items.map((i) => [i.id, i]));
  const picked = new Map<string, ExerciseItem>();
  for (const id of [...missed, ...items.map((i) => i.id)]) {
    const item = byId.get(id);
    if (item && !picked.has(id)) picked.set(id, item);
    if (picked.size === 3) break;
  }
  return [...picked.values()];
}

/** Generate `count` items for a library set, keep the valid ones and return them. */
export async function generateMore(
  userId: number,
  setId: string,
  count: number,
  log: FastifyBaseLogger,
): Promise<{ items: ExerciseItem[]; received: number }> {
  const set = loadExerciseSets().find((s) => s.id === setId);
  if (!set) throw new GenerateError(404, "No such exercise set.");
  const ai = getAiChain(userId);
  if (!ai) throw new GenerateError(503, "Set up your AI tutor under Settings → Connections first.");
  const items = [...set.items, ...listGenerated(userId, setId)];
  const { system, user } = buildGenerateMessages({
    title: set.title,
    level: set.level,
    tags: set.tags,
    types: [...new Set(set.items.map((i) => i.type))],
    count,
    samples: JSON.stringify(samples(userId, setId, items)).slice(0, 3000),
  });

  let content: string;
  try {
    // Scale the token budget with how many items were asked for (each item
    // is a few hundred tokens of JSON).
    content = await collectCompletion(
      ai,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        temperature: 0.8,
        maxTokens: Math.min(8192, 1024 + count * 500),
        onFallback: (failed, error) =>
          log.warn({ provider: failed.provider, model: failed.model, error: error.publicMessage }, "AI model failed, trying the next one"),
      },
    );
  } catch (err) {
    throw new GenerateError(502, aiErrorMessage(err, log, "generate"));
  }

  let raw: unknown[] = [];
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { items?: unknown };
      if (Array.isArray(parsed.items)) raw = parsed.items;
    } catch {
      /* leave empty → 0 valid items */
    }
  }
  const stamp = Date.now().toString(36);
  const fresh = raw
    .map((r, i) => validGeneratedItem(r, `gen-${stamp}-${i}`))
    .filter((x): x is ExerciseItem => x !== null)
    .slice(0, count);
  if (fresh.length < raw.length) log.warn({ received: raw.length, valid: fresh.length }, "generate: some items failed validation and were dropped");
  if (fresh.length > 0) {
    db.insert(schema.generatedItems)
      .values(fresh.map((item) => ({ userId, setId, itemId: item.id, item })))
      .run();
  }
  return { items: fresh, received: raw.length };
}
