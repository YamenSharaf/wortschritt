import { eq } from "drizzle-orm";
import type { WordDetails } from "@mdb/shared";
import { guardedFetch } from "../assistant/egress";
import { db, schema } from "../db/client";
import { env } from "../env";

/**
 * Fuller dictionary data from Wiktionary (via freedictionaryapi.com), shown
 * under the instant offline gloss. Every word is fetched at most once: hits
 * are cached for good, misses retried after a week, errors not cached. The
 * request goes through the egress guard (https, public address, no
 * redirects) with a timeout and a size cap.
 */

const NOT_FOUND_RETRY_S = 7 * 24 * 60 * 60;
const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 4;
const MAX_SENSES = 8;
const MAX_EXAMPLES = 2;

const now = () => Math.floor(Date.now() / 1000);

export const onlineDictionaryEnabled = () => env.DICTIONARY_API_URL !== "off";

// The parts of the API response we use (see its OpenAPI spec).
type ApiSense = { definition?: string; tags?: string[]; examples?: string[]; subsenses?: ApiSense[] };
type ApiEntry = {
  language?: { code?: string };
  partOfSpeech?: string;
  pronunciations?: { type?: string; text?: string }[];
  senses?: ApiSense[];
};
type ApiResponse = {
  word?: string;
  entries?: ApiEntry[];
  source?: { url?: string; license?: { name?: string; url?: string } };
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The API response, trimmed to what the popup shows. */
export function parseEntries(word: string, res: ApiResponse): WordDetails | null {
  const entries = (res.entries ?? [])
    .filter((e) => (e.language?.code ?? "de") === "de" && e.senses?.length)
    .slice(0, MAX_ENTRIES)
    .map((e) => {
      // Subsenses count as senses when a sense has no definition of its own.
      const flat = (e.senses ?? []).flatMap((s) => (s.definition?.trim() ? [s] : (s.subsenses ?? [])));
      return {
        pos: e.partOfSpeech ?? "",
        ipa: e.pronunciations?.find((p) => p.type === "ipa" && p.text)?.text ?? null,
        senses: flat
          .filter((s) => s.definition?.trim())
          .slice(0, MAX_SENSES)
          .map((s) => ({
            definition: clip(s.definition!.trim(), 300),
            tags: (s.tags ?? []).slice(0, 6),
            examples: (s.examples ?? []).filter(Boolean).slice(0, MAX_EXAMPLES).map((x) => clip(x, 300)),
          })),
      };
    })
    .filter((e) => e.senses.length);
  if (!entries.length) return null;
  return {
    word: res.word ?? word,
    formOf: null,
    entries,
    source: {
      url: res.source?.url ?? `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
      license: res.source?.license?.name ?? "CC BY-SA 4.0",
      licenseUrl: res.source?.license?.url ?? "https://creativecommons.org/licenses/by-sa/4.0/",
    },
  };
}

/**
 * If every sense is an inflection ("form of"), the base form it points to:
 * "first/third-person singular preterite of gehen" → "gehen".
 */
export function formOfTarget(d: WordDetails): { target: string; definition: string } | null {
  const senses = d.entries.flatMap((e) => e.senses);
  if (!senses.length || !senses.every((s) => s.tags.includes("form of"))) return null;
  const definition = senses[0]!.definition;
  const m = [...definition.matchAll(/\bof ([\p{L}ß][\p{L}ß'-]*)/gu)].pop();
  const target = m?.[1];
  return target && target !== d.word ? { target, definition } : null;
}

const inflight = new Map<string, Promise<WordDetails | null>>();

/** One word, from the cache or the API. Null = not found or unavailable. */
async function fetchWord(word: string): Promise<WordDetails | null> {
  const cached = db.select().from(schema.dictCache).where(eq(schema.dictCache.word, word)).get();
  if (cached && (cached.data || now() - cached.fetchedAt < NOT_FOUND_RETRY_S)) return cached.data ?? null;

  let pending = inflight.get(word);
  if (!pending) {
    pending = (async () => {
      const url = `${env.DICTIONARY_API_URL}/entries/de/${encodeURIComponent(word)}`;
      const res = await guardedFetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      let details: WordDetails | null = null;
      if (res.status === 404) {
        details = null;
      } else if (!res.ok) {
        throw new Error(`dictionary API: HTTP ${res.status}`);
      } else {
        if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("dictionary API: too large");
        const text = await res.text();
        if (text.length > MAX_BYTES) throw new Error("dictionary API: too large");
        details = parseEntries(word, JSON.parse(text) as ApiResponse);
      }
      db.insert(schema.dictCache)
        .values({ word, data: details, fetchedAt: now() })
        .onConflictDoUpdate({ target: schema.dictCache.word, set: { data: details, fetchedAt: now() } })
        .run();
      return details;
    })().finally(() => inflight.delete(word));
    inflight.set(word, pending);
  }
  return pending;
}

/**
 * Details for a word: tries each candidate in order (the offline base form,
 * then the word as tapped), and follows one "form of" hop to the base form.
 * Network problems resolve to null (the popup keeps the offline gloss).
 */
export async function wordDetails(candidates: string[]): Promise<WordDetails | null> {
  if (!onlineDictionaryEnabled()) return null;
  try {
    for (const word of [...new Set(candidates.map((c) => c.trim()).filter(Boolean))]) {
      const d = await fetchWord(word);
      if (!d) continue;
      const form = formOfTarget(d);
      if (!form) return d;
      const base = await fetchWord(form.target);
      return base ? { ...base, formOf: form.definition } : d;
    }
    return null;
  } catch {
    return null;
  }
}
