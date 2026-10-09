import assert from "node:assert/strict";
import { test } from "node:test";
import type { SaveVocabBody, VocabEntry, VocabGroup } from "@mdb/shared";
import type { Api } from "../api";
import { act, flush, renderHook } from "./testing";
import { filterVocab, useAddWord, useFlashcards, useVocabState, useWordTranslation, type VocabState } from "./useVocab";

const entry = (word: string, patch: Partial<VocabEntry> = {}): VocabEntry =>
  ({ word, display: word, translation: `${word} (en)`, examples: [], groups: [], stats: null, createdAt: 1, ...patch }) as VocabEntry;

/** A fake vocab server holding entries and groups in memory. */
function vocabApi(start: VocabEntry[] = [], calls: string[] = []): Partial<Api> {
  let entries = [...start];
  const groups: VocabGroup[] = [];
  return {
    assistantStatus: async () => ({ enabled: true, model: "m" }),
    dictStatus: async () => ({ available: false }),
    vocab: async () => entries,
    vocabGroups: async () => groups,
    vocabSave: async (b: SaveVocabBody) => {
      calls.push(`save ${b.word} ${b.translation}${b.forms ? ` ${JSON.stringify(b.forms)}` : ""}`);
      const e = entry(b.word.toLowerCase(), { display: b.display, translation: b.translation, examples: b.examples ?? [], createdAt: 2 });
      entries = [e, ...entries.filter((x) => x.word !== e.word)];
      return e;
    },
    vocabRemove: async (w) => void calls.push(`remove ${w}`) as never,
    vocabGroupCreate: async (name) => {
      const g = { id: groups.length + 1, name, count: 0 } as VocabGroup;
      groups.push(g);
      return g;
    },
    vocabGroupAddWord: async (id, w) => void calls.push(`group ${id} + ${w}`) as never,
    vocabGroupRemoveWord: async (id, w) => void calls.push(`group ${id} - ${w}`) as never,
    studyVocab: async (w, known) => ({ known: known ? 1 : 0, missed: known ? 0 : 1, lastResult: known }) as never,
    translateWord: async (w, opts) => {
      calls.push(`translate ${w}${opts?.meaning ? ` meaning=${opts.meaning}` : ""}`);
      return { lemma: "treffen", translation: "to meet", examples: [{ de: "Wir treffen uns.", en: "We meet." }], pos: "verb", partizip2: "getroffen" } as never;
    },
  };
}

test("useVocabState: changes go to the server and update the list in place", async () => {
  const calls: string[] = [];
  const h = renderHook(() => useVocabState(), vocabApi([entry("haus")], calls));
  await flush();
  assert.equal(h.current().enabled, true);
  assert.equal(h.current().canTap, true);
  assert.ok(h.current().words.has("haus"));

  await act(async () => void (await h.current().save({ word: "Baum", display: "Baum", translation: "tree", examples: [] })));
  assert.deepEqual(h.current().entries.map((e) => e.word), ["baum", "haus"], "newest first");

  let g!: VocabGroup;
  await act(async () => void (g = await h.current().createGroup("Natur")));
  await act(() => h.current().setWordGroup("Baum", g.id, true));
  assert.deepEqual(h.current().entries[0]!.groups, [g.id]);
  assert.equal(h.current().groups[0]!.count, 1);

  await act(() => h.current().recordStudy("Baum", false));
  assert.equal(h.current().entries[0]!.stats?.lastResult, false);
  await act(() => h.current().remove("Haus"));
  assert.deepEqual([...h.current().words], ["baum"]);
  assert.deepEqual(calls, ["save Baum tree", "group 1 + Baum", "remove Haus"]);
  h.unmount();
});

test("filterVocab: by group and by a search in either language", () => {
  const list = [entry("haus", { groups: [1] }), entry("baum", { translation: "tree" })];
  assert.deepEqual(filterVocab(list, { group: 1 }).map((e) => e.word), ["haus"]);
  assert.deepEqual(filterVocab(list, { group: null, query: " TREE " }).map((e) => e.word), ["baum"]);
  assert.equal(filterVocab(list, { group: null }).length, 2);
});

test("useWordTranslation: saves under the base form with its forms, into a new group", async () => {
  const calls: string[] = [];
  const api = vocabApi([], calls);
  const h = renderHook(() => {
    const vocab = useVocabState();
    return { vocab, tr: useWordTranslation({ display: "trifft", context: "Er trifft sie.", dict: null, vocab }) };
  }, api);
  await flush();
  assert.equal(h.current().tr.headword, "treffen");
  assert.equal(h.current().tr.inflected, true);
  assert.equal(h.current().tr.savedEntry, undefined);

  await act(() => h.current().tr.addToNewGroup(" Verben "));
  assert.equal(h.current().tr.savedEntry?.word, "treffen");
  assert.deepEqual(calls, [
    "translate trifft",
    'save treffen to meet {"pos":"verb","partizip2":"getroffen"}',
    "group 1 + treffen",
  ]);
  h.unmount();
});

test("useWordTranslation: a word saved in the tapped form isn't looked up", async () => {
  const calls: string[] = [];
  const vocab = { entries: [entry("haus")] } as VocabState;
  const h = renderHook(() => useWordTranslation({ display: "Haus", dict: null, vocab }), vocabApi([], calls));
  await flush();
  assert.equal(h.current().data?.translation, "haus (en)");
  assert.deepEqual(calls, []);
  h.unmount();
});

test("useAddWord: a blank translation is filled by the AI; a typed one gets examples", async () => {
  const calls: string[] = [];
  const saved: SaveVocabBody[] = [];
  const keep = async (b: SaveVocabBody) => void saved.push(b);
  const h = renderHook(() => useAddWord({ enabled: true, dictAvailable: false }), vocabApi([], calls));

  act(() => h.current().setWord("trifft"));
  await act(() => h.current().add(keep));
  assert.equal(saved[0]?.word, "treffen");
  assert.equal(saved[0]?.translation, "to meet");
  assert.equal(h.current().word, "", "the form is cleared");

  act(() => h.current().setWord("trifft"));
  act(() => h.current().setDefinition("meets"));
  await act(() => h.current().add(keep));
  assert.equal(saved[1]?.translation, "meets", "the typed translation is kept");
  assert.equal(saved[1]?.examples?.length, 1);
  assert.deepEqual(calls, ["translate trifft", "translate trifft meaning=meets"]);

  const offline = renderHook(() => useAddWord({ enabled: false, dictAvailable: false }), {});
  act(() => offline.current().setWord("Haus"));
  await act(() => offline.current().add(keep));
  assert.equal(offline.current().error, "Add a translation, or generate one.");
  h.unmount();
  offline.unmount();
});

test("useFlashcards: grades every card, then offers the missed ones again", async () => {
  const graded: string[] = [];
  const pool = [entry("eins"), entry("zwei"), entry("drei")];
  const h = renderHook(() => useFlashcards(pool, async (w, known) => void graded.push(`${w} ${known}`)), {});
  assert.equal(h.current().phase, "playing");
  assert.equal(h.current().queue.length, 3);

  act(() => h.current().flip());
  assert.equal(h.current().flipped, true);
  for (const known of [true, false, true]) act(() => h.current().grade(known));
  assert.equal(h.current().phase, "done");
  assert.equal(h.current().knownCount, 2);
  assert.equal(h.current().percent, 67);
  assert.equal(graded.length, 3);

  act(() => h.current().start(h.current().missed));
  assert.equal(h.current().phase, "playing");
  assert.equal(h.current().queue.length, 1);
  assert.equal(h.current().flipped, false);
  h.unmount();
});
