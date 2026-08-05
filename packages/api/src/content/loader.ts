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
    out.push(parsed.data);
  }
  return out;
}

/** Git-versioned exercise sets + those imported at runtime, merged by id. */
export function loadExerciseSets(): ExerciseSet[] {
  const fromFiles = readJsonDir(
    join(resolve(env.CONTENT_DIR), "exercises"),
    exerciseSet,
  );
  const fromDb = db
    .select()
    .from(schema.importedContent)
    .all()
    .filter((r) => r.kind === "exercise")
    .map((r) => exerciseSet.parse(r.data));
  return dedupeById([...fromFiles, ...fromDb]);
}

/** Git-versioned cheatsheets + those imported at runtime, merged by id. */
export function loadCheatsheets(): Cheatsheet[] {
  const fromFiles = readJsonDir(
    join(resolve(env.CONTENT_DIR), "cheatsheets"),
    cheatsheet,
  );
  const fromDb = db
    .select()
    .from(schema.importedContent)
    .all()
    .filter((r) => r.kind === "cheatsheet")
    .map((r) => cheatsheet.parse(r.data));
  return dedupeById([...fromFiles, ...fromDb]);
}

/** Runtime imports (DB) win over file content when ids collide. */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}
