import type { DictEntry, VocabForms } from "@mdb/shared";
import { rawDb } from "../db/client";

/**
 * Offline dictionary lookup: resolve an inflected German surface form to its
 * lemma (via the bundled forms index) and attach a curated English gloss when
 * one exists. Everything is a prepared-statement hit against SQLite, so this is
 * sub-millisecond and safe to call on every tap.
 */

type FormRow = { lemma: string; pos: string; gender: string; plural: string };
type GlossRow = { gloss: string; pos: string };

// Prepared lazily: the tables are created by ensureSchema() at boot, which runs
// after this module is imported, so we can't prepare at module load time.
let stmts: {
  form: import("better-sqlite3").Statement;
  glossPos: import("better-sqlite3").Statement;
  glossAny: import("better-sqlite3").Statement;
  verb: import("better-sqlite3").Statement;
  count: import("better-sqlite3").Statement;
} | null = null;
function s() {
  if (!stmts) {
    stmts = {
      form: rawDb.prepare(
        "SELECT lemma, pos, gender, plural FROM dict_forms WHERE form = ?",
      ),
      glossPos: rawDb.prepare(
        "SELECT gloss FROM dict_gloss WHERE lemma = ? AND pos = ?",
      ),
      glossAny: rawDb.prepare(
        "SELECT gloss, pos FROM dict_gloss WHERE lemma = ? LIMIT 1",
      ),
      verb: rawDb.prepare("SELECT partizip2 FROM dict_verbs WHERE lemma = ?"),
      count: rawDb.prepare(
        "SELECT (SELECT count(*) FROM dict_forms) + (SELECT count(*) FROM dict_gloss) AS c",
      ),
    };
  }
  return stmts;
}

/** Partizip II for a verb lemma (e.g. treffen → getroffen), else null. */
function participle(lemma: string, pos: string): string | null {
  if (pos !== "verb") return null;
  const r = s().verb.get(lemma.toLowerCase()) as
    | { partizip2: string }
    | undefined;
  return r?.partizip2 ?? null;
}

/** Whether any dictionary data is loaded (drives the client's tap gating). */
export function dictAvailable(): boolean {
  try {
    return (s().count.get() as { c: number }).c > 0;
  } catch {
    return false;
  }
}

const ARTICLE: Record<string, string> = { M: "der", F: "die", N: "das" };

const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
function clean(w: string): string {
  return w.normalize("NFC").replace(EDGE, "").trim();
}

function deumlaut(w: string): string {
  return w
    .replace(/äu/g, "au")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u");
}

// Closed-class words: when the curated core knows one of these by its exact
// surface, that meaning is authoritative and must not be shadowed by a stray
// verb-form leaf in the index (e.g. "auf" the preposition, not a form of
// "aufatmen").
const FUNCTION = new Set(["prep", "conj", "det", "pron", "adv", "num", "interj"]);

// Endings peeled off (longest first) when a form isn't found directly —
// adjective declension, comparatives/superlatives, weak participles. Each
// candidate is validated against the DB, so over-generating is harmless.
const ENDINGS = [
  "esten", "ester", "estes", "estem", "este",
  "sten", "ster", "stes", "stem", "ste",
  "eren", "erer", "eres", "erem", "ere",
  "ten", "tes", "tem", "te",
  "en", "em", "er", "es", "e", "n", "s",
];

function candidates(low: string): string[] {
  const out = new Set<string>();
  const push = (c: string) => {
    if (c.length >= 2) out.add(c);
  };
  for (const end of ENDINGS) {
    if (low.length - end.length >= 2 && low.endsWith(end)) {
      const base = low.slice(0, low.length - end.length);
      push(base);
      push(deumlaut(base)); // älter → alt, größ(ten) → groß
    }
  }
  push(deumlaut(low));
  return [...out];
}

function glossFor(lemma: string, pos: string): string | null {
  const key = lemma.toLowerCase();
  const byPos = s().glossPos.get(key, pos) as { gloss: string } | undefined;
  if (byPos) return byPos.gloss;
  const any = s().glossAny.get(key) as GlossRow | undefined;
  return any?.gloss ?? null;
}

function fromForm(surface: string, fr: FormRow): DictEntry {
  return {
    surface,
    lemma: fr.lemma,
    pos: fr.pos,
    article: ARTICLE[fr.gender] ?? null,
    plural: fr.plural || null,
    partizip2: participle(fr.lemma, fr.pos),
    gloss: glossFor(fr.lemma, fr.pos),
  };
}

function glossEntry(surface: string, lemma: string, row: GlossRow): DictEntry {
  return {
    surface,
    lemma,
    pos: row.pos,
    article: null,
    plural: null,
    partizip2: participle(lemma, row.pos),
    gloss: row.gloss,
  };
}

/**
 * Try to resolve via morphological stripping. Returns the first candidate that
 * hits the forms index or the gloss core. When `requireGloss` is set, only a
 * result that carries a curated gloss counts (used to prefer a real adjective
 * over a glossless, obscure nominalised noun).
 */
function heuristic(surface: string, low: string, requireGloss: boolean): DictEntry | null {
  for (const cand of candidates(low)) {
    // A curated core headword (e.g. adj "gut") outranks an obscure noun form
    // that shares the stripped stem (e.g. "das Gut"), so check the gloss first.
    const cg = s().glossAny.get(cand) as GlossRow | undefined;
    if (cg) return glossEntry(surface, cand, cg);
    const cf = s().form.get(cand) as FormRow | undefined;
    if (cf) {
      const e = fromForm(surface, cf);
      if (!requireGloss || e.gloss) return e;
    }
  }
  return null;
}

export function lookupWord(word: string): DictEntry | null {
  const c = clean(word);
  if (!c) return null;
  const low = c.toLowerCase();

  const direct = s().glossAny.get(low) as GlossRow | undefined;
  const fr = s().form.get(low) as FormRow | undefined;

  // 1. A closed-class curated headword wins outright (function words), so a
  //    stray verb-form leaf can't shadow "auf", "in", "und", …
  if (direct && FUNCTION.has(direct.pos)) return glossEntry(c, c, direct);

  // 2. The surface is itself a curated headword (e.g. "gut", "Haus"). Trust the
  //    core meaning. If the forms index agrees on the same lemma+pos, merge it
  //    in to keep the noun's article/plural; otherwise the core wins outright
  //    (fixes the adjective "gut" vs. the rare noun "das Gut").
  if (direct) {
    if (fr && fr.lemma.toLowerCase() === low && fr.pos === direct.pos) {
      return fromForm(c, fr);
    }
    return glossEntry(c, c, direct);
  }

  // 3. Exact inflected form → lemma (+ gender/plural/gloss).
  if (fr) {
    const e = fromForm(c, fr);
    if (e.gloss) return e;
    // Glossless obscure noun (often a nominalised adjective like "Schöne"):
    // prefer a stripped form that actually has a curated gloss ("schön").
    return heuristic(c, low, true) ?? e;
  }

  // 4. Morphological fallbacks (adjective endings, umlaut), each DB-validated.
  return heuristic(c, low, false);
}

/**
 * Grammatical forms for a saved vocab word, derived from the offline data:
 * part of speech, Partizip II (verbs), article + plural (nouns). Returns null
 * when the word isn't recognised.
 */
export function formsFor(word: string): VocabForms | null {
  const e = lookupWord(word);
  if (!e || !e.pos) return null;
  return {
    pos: e.pos,
    article: e.article ?? null,
    plural: e.plural ?? null,
    partizip2: e.partizip2 ?? null,
    auxiliary: null, // the offline data has no perfect auxiliary
  };
}
