import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { rawDb } from "./client";

/**
 * Bump when any asset changes so existing databases re-seed on next boot.
 */
const DICT_VERSION = "2";

const assetsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../assets",
);

type Logger = { info: (msg: string) => void; warn: (msg: string) => void };

/**
 * Populate the dictionary tables from the committed assets, once. Idempotent:
 * skips when the current version is already loaded. Never throws — a missing or
 * unreadable asset just leaves the dictionary empty (the app falls back to the
 * AI tutor for translations).
 */
export function seedDictionary(log?: Logger): void {
  try {
    const meta = rawDb
      .prepare("SELECT v FROM dict_meta WHERE k = 'version'")
      .get() as { v?: string } | undefined;
    const count = rawDb
      .prepare("SELECT count(*) AS c FROM dict_forms")
      .get() as { c: number };
    if (meta?.v === DICT_VERSION && count.c > 0) return;

    rawDb.exec(
      "DELETE FROM dict_forms; DELETE FROM dict_gloss; DELETE FROM dict_verbs;",
    );

    const forms = seedForms();
    const gloss = seedGloss();
    const verbs = seedVerbs();

    rawDb
      .prepare("INSERT OR REPLACE INTO dict_meta(k, v) VALUES('version', ?)")
      .run(DICT_VERSION);
    log?.info(
      `dictionary seeded: ${forms} forms, ${gloss} glosses, ${verbs} verb participles`,
    );
  } catch (err) {
    log?.warn(`dictionary seed skipped: ${String(err)}`);
  }
}

function seedForms(): number {
  const path = resolve(assetsDir, "dict-forms.tsv.gz");
  if (!existsSync(path)) return 0;
  const tsv = gunzipSync(readFileSync(path)).toString("utf8");
  const ins = rawDb.prepare(
    "INSERT OR IGNORE INTO dict_forms(form, lemma, pos, gender, plural) VALUES(?,?,?,?,?)",
  );
  let n = 0;
  const tx = rawDb.transaction((lines: string[]) => {
    for (const line of lines) {
      if (!line) continue;
      const [form, lemma, pos, gender, plural] = line.split("\t");
      if (!form || !lemma) continue;
      ins.run(form, lemma, pos ?? "", gender ?? "", plural ?? "");
      n++;
    }
  });
  tx(tsv.split("\n"));
  return n;
}

function seedVerbs(): number {
  const path = resolve(assetsDir, "dict-verb-forms.tsv.gz");
  if (!existsSync(path)) return 0;
  const tsv = gunzipSync(readFileSync(path)).toString("utf8");
  const ins = rawDb.prepare(
    "INSERT OR IGNORE INTO dict_verbs(lemma, partizip2) VALUES(?,?)",
  );
  let n = 0;
  const tx = rawDb.transaction((lines: string[]) => {
    for (const line of lines) {
      if (!line) continue;
      const [lemma, pa2] = line.split("\t");
      if (!lemma || !pa2) continue;
      ins.run(lemma, pa2);
      n++;
    }
  });
  tx(tsv.split("\n"));
  return n;
}

function seedGloss(): number {
  const path = resolve(assetsDir, "dict-core-gloss.tsv");
  if (!existsSync(path)) return 0;
  const tsv = readFileSync(path, "utf8");
  const ins = rawDb.prepare(
    "INSERT OR IGNORE INTO dict_gloss(lemma, pos, gloss) VALUES(?,?,?)",
  );
  let n = 0;
  const tx = rawDb.transaction((lines: string[]) => {
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [lemma, pos, gloss] = raw.split("\t");
      if (!lemma || !gloss) continue;
      ins.run(lemma.trim().toLowerCase(), (pos ?? "").trim(), gloss.trim());
      n++;
    }
  });
  tx(tsv.split("\n"));
  return n;
}
