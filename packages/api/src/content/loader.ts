import { readdirSync, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cheatsheet,
  exerciseSet,
  type Cheatsheet,
  type ExerciseSet,
} from "@mdb/shared";
import { z } from "zod";
import { db, schema } from "../db/client";
import { env } from "../env";

function readJsonDir<S extends z.ZodTypeAny>(
  dir: string,
  schema: S,
): z.infer<S>[] {
  if (!existsSync(dir)) return [];
  const out: z.infer<S>[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const full = join(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(full, "utf8"));
    } catch (e) {
      throw new Error(`Content file ${full} is not valid JSON: ${String(e)}`);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      throw new Error(`Content file ${full} failed validation:\n${detail}`);
    }
    // Keep the author's createdAt as-is. We deliberately DON'T fall back to the
    // file's mtime: a fresh git clone / Docker build resets every file's mtime
    // to the deploy time, which would make old, un-dated files look newest and
    // bury genuinely new material. Un-dated content sorts last instead (see
    // byNewest). All shipped content is stamped with a createdAt.
    out.push(parsed.data);
  }
  return out;
}

/** Newest first, by createdAt (missing dates sort last). */
function byNewest<T extends { createdAt?: string }>(items: T[]): T[] {
  const ts = (v?: string) => (v ? Date.parse(v) || 0 : 0);
  return [...items].sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
}

/** Ids of the git-versioned (built-in) content of one kind. */
export function builtInIds(kind: "exercise" | "cheatsheet"): Set<string> {
  const items =
    kind === "exercise"
      ? readJsonDir(join(resolve(env.CONTENT_DIR), "exercises"), exerciseSet)
      : readJsonDir(join(resolve(env.CONTENT_DIR), "cheatsheets"), cheatsheet);
  return new Set(items.map((i) => i.id));
}

/** Git-versioned exercise sets + those imported at runtime, merged by id. */
export function loadExerciseSets(): ExerciseSet[] {
  const fromFiles = readJsonDir(
    join(resolve(env.CONTENT_DIR), "exercises"),
    exerciseSet,
  );
  return byNewest(dedupeById([...fromFiles, ...imported("exercise", exerciseSet)]));
}

/** Git-versioned cheatsheets + those imported at runtime, merged by id. */
export function loadCheatsheets(): Cheatsheet[] {
  const fromFiles = readJsonDir(
    join(resolve(env.CONTENT_DIR), "cheatsheets"),
    cheatsheet,
  );
  return byNewest(dedupeById([...fromFiles, ...imported("cheatsheet", cheatsheet)]));
}

/** Ids already reported as invalid, so the warning isn't repeated per request. */
const reportedInvalid = new Set<string>();

/**
 * Runtime imports of one kind. Imports were validated when they were saved,
 * but the schema can get stricter later (e.g. unique item ids): an import
 * that no longer passes is skipped and logged once, instead of breaking the
 * whole list for everyone. Re-importing a fixed version brings it back.
 */
function imported<S extends z.ZodTypeAny>(
  kind: "exercise" | "cheatsheet",
  schema_: S,
): (z.infer<S> & { createdAt: string })[] {
  const out: (z.infer<S> & { createdAt: string })[] = [];
  const rows = db
    .select()
    .from(schema.importedContent)
    .all()
    .filter((r) => r.kind === kind);
  for (const r of rows) {
    const parsed = schema_.safeParse(r.data);
    if (parsed.success) {
      out.push({ ...parsed.data, createdAt: r.createdAt.toISOString() });
      continue;
    }
    if (!reportedInvalid.has(r.id)) {
      reportedInvalid.add(r.id);
      const issues = parsed.error.issues.map(
        (i: z.ZodIssue) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      );
      console.warn(
        JSON.stringify({ level: 40, msg: "skipping invalid imported content", id: r.id, kind, issues }),
      );
    }
  }
  return out;
}

/** Runtime imports (DB) win over file content when ids collide. */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}
