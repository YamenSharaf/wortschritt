import {
  gradeItem,
  responseText,
  vocabKey,
  withoutTutor,
  type AnswerBody,
  type AnswerVerdict,
  type ExerciseItem,
  type ExerciseProgress,
  type Note,
  type SaveNoteBody,
  type SaveVocabBody,
  type SeriesSummary,
  type SeriesView,
  type Settings,
  type StorySummary,
  type StoryView,
  type SyncOp,
  type SyncStats,
  type SyncStory,
  type VocabEntry,
  type VocabGroup,
  type VocabStat,
} from "@mdb/shared";
import type { Api } from "../api";
import type { OfflineStore } from "./store";
import { isNetworkError, META, type LocalLibrary, type Sync } from "./sync";

/** A queued action before it gets its id. */
type OpInput = SyncOp extends infer O ? (O extends SyncOp ? Omit<O, "opId"> : never) : never;

let counter = 0;
/** An op id (8–64 chars) unique enough for one device. */
function randomId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Notes created offline get this id until the server has them. */
const LOCAL_NOTE = "local-";
export const isLocalNote = (id: string) => id.startsWith(LOCAL_NOTE);

/**
 * The API as the app's screens see it, offline-first: the same shape as
 * createApi (so @mdb/client/react's hooks work unchanged), but once a first
 * sync has filled the store, the learner's data is read from it, and the
 * actions the change feed covers go to the server directly when it can be
 * reached and nothing is queued, or into the outbox otherwise (pushed in
 * order by the next sync). Everything else (the tutor, history, settings
 * screens, …) still needs the server.
 *
 * What the app shows offline is the server's last answer plus the learner's
 * own explicit actions (a word saved, a story marked read); numbers like the
 * daily goal stay as last synced. An answer gets a provisional verdict from
 * the item's own rules (no tutor), as the server will grade it on push.
 */
export function createOfflineApi(o: {
  api: Api;
  store: OfflineStore;
  sync: Sync;
  newId?: () => string;
  /** ms since epoch */
  now?: () => number;
}): Api {
  const { api, store, sync } = o;
  const newId = o.newId ?? randomId;
  const nowMs = o.now ?? Date.now;
  const nowS = () => Math.floor(nowMs() / 1000);

  /** Read locally once synced; `undefined` from `read` (or no data yet) asks the server. */
  async function local<T>(read: () => Promise<T | undefined>, online: () => Promise<T>): Promise<T> {
    if (await sync.hasData()) {
      const v = await read();
      if (v !== undefined) return v;
    }
    return online();
  }

  /**
   * An action the change feed covers: straight to the server when nothing is
   * queued and it can be reached (`mirror` then copies the result into the
   * store), else applied locally by `offline` and queued.
   */
  async function write<T>(
    op: OpInput,
    online: () => Promise<T>,
    mirror: (result: T) => Promise<void>,
    offline: (opId: string) => Promise<T>,
  ): Promise<T> {
    if ((await store.pendingCount()) === 0) {
      try {
        const r = await online();
        if (await sync.hasData()) await mirror(r);
        sync.schedule(2000); // the server's numbers changed: refresh them soon
        return r;
      } catch (e) {
        if (!isNetworkError(e)) throw e;
      }
    }
    const opId = newId();
    const r = await offline(opId);
    await store.enqueue({ ...op, opId } as SyncOp);
    await sync.refreshPending();
    sync.schedule();
    return r;
  }

  // --- local state helpers -------------------------------------------------

  const stats = () => store.get<SyncStats>("meta", META.stats);
  const library = () => store.get<LocalLibrary>("meta", META.library);

  async function updateStats(fn: (s: SyncStats) => void) {
    const s = await stats();
    if (!s) return;
    fn(s);
    await store.put("meta", META.stats, s);
  }

  async function updateSession(setId: string, fn: (p: ExerciseProgress) => ExerciseProgress | null) {
    await updateStats((s) => {
      const cur = s.exerciseProgress.find((p) => p.setId === setId) ?? {
        setId,
        index: 0,
        results: {},
        responses: {},
        ungraded: [],
        updatedAt: nowS(),
      };
      const next = fn({ ...cur });
      s.exerciseProgress = s.exerciseProgress.filter((p) => p.setId !== setId);
      if (next) s.exerciseProgress.unshift({ ...next, updatedAt: nowS() });
    });
  }

  async function updateStory(id: string, fn: (s: SyncStory) => void) {
    const s = await store.get<SyncStory>("stories", id);
    if (!s) return;
    fn(s);
    await store.put("stories", id, s);
  }

  /** The item an answer is for: a story's questions, or a set plus the learner's generated items. */
  async function findItem(setId: string, itemId: string): Promise<ExerciseItem | undefined> {
    if (setId.startsWith("story:")) {
      const s = await store.get<SyncStory>("stories", setId.slice("story:".length));
      return s?.story.questions.find((q) => q.id === itemId);
    }
    const set = (await library())?.exerciseSets.find((x) => x.id === setId);
    const extra = (await store.get<ExerciseItem[]>("generated", setId)) ?? [];
    return [...(set?.items ?? []), ...extra].find((i) => i.id === itemId);
  }

  async function recordAnswer(body: AnswerBody, v: AnswerVerdict) {
    const item = await findItem(body.setId, body.itemId);
    await updateSession(body.setId, (p) => ({
      ...p,
      results: { ...p.results, [body.itemId]: v.correct },
      responses: item ? { ...p.responses, [body.itemId]: responseText(item, body.response) } : p.responses,
      ungraded: [...p.ungraded.filter((i) => i !== body.itemId), ...(v.grading === "ungraded" ? [body.itemId] : [])],
    }));
  }

  async function putVocab(e: VocabEntry) {
    await store.put("vocab", e.word, e);
  }

  async function removeVocabLocal(word: string) {
    const e = await store.get<VocabEntry>("vocab", vocabKey(word));
    await store.remove("vocab", vocabKey(word));
    for (const g of e?.groups ?? []) {
      const group = await store.get<VocabGroup>("groups", String(g));
      if (group) await store.put("groups", String(g), { ...group, count: Math.max(0, group.count - 1) });
    }
  }

  /** A note made offline that has reached the server since: its server id (else `id`). */
  async function resolveNote(id: string): Promise<string> {
    return isLocalNote(id) ? ((await store.get<string>("meta", META.noteAlias + id)) ?? id) : id;
  }

  /** The queued create of a note made offline, if `id` is one. */
  async function pendingCreate(id: string): Promise<Extract<SyncOp, { type: "noteCreate" }> | undefined> {
    for (const op of await store.pending())
      if (op.type === "noteCreate" && (await store.get<string>("meta", META.localNote + op.opId)) === id) return op;
    return undefined;
  }

  async function pendingUpdate(id: string): Promise<Extract<SyncOp, { type: "noteUpdate" }> | undefined> {
    for (const op of await store.pending()) if (op.type === "noteUpdate" && op.id === id) return op;
    return undefined;
  }

  const toStorySummary = (s: SyncStory): StorySummary => ({
    id: s.story.id,
    seriesId: s.series?.id ?? null,
    chapter: s.series?.chapter ?? null,
    title: s.story.title,
    subtitle: s.story.subtitle,
    level: s.story.level,
    tags: s.story.tags,
    words: s.words,
    minutes: s.minutes,
    questions: s.story.questions.length,
    cover: s.cover,
    progress: s.progress,
    readAt: s.readAt,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  });
  const toStoryView = ({ cover: _c, translations: _t, words: _w, ...view }: SyncStory): StoryView => view;
  const toSeriesSummary = ({ series: _s, chapters: _c, ...summary }: SeriesView): SeriesSummary => summary;
  const newest = <T extends { updatedAt: number }>(a: T, b: T) => b.updatedAt - a.updatedAt;

  return {
    ...api,

    // --- reads ---------------------------------------------------------------

    stories: () =>
      local(async () => (await store.all<SyncStory>("stories")).map(toStorySummary).sort(newest), api.stories),
    story: (id) =>
      local(async () => {
        const s = await store.get<SyncStory>("stories", id);
        return s ? toStoryView(s) : undefined;
      }, () => api.story(id)),
    storyTranslations: (id) =>
      local(async () => (await store.get<SyncStory>("stories", id))?.translations ?? undefined, () => api.storyTranslations(id)),
    async translateStory(id, paragraphs) {
      const t = await api.translateStory(id, paragraphs);
      await updateStory(id, (s) => void (s.translations = t));
      return t;
    },
    seriesList: () =>
      local(async () => (await store.all<SeriesView>("series")).map(toSeriesSummary).sort(newest), api.seriesList),
    series: (id) => local(async () => (await store.get<SeriesView>("series", id)) ?? undefined, () => api.series(id)),

    vocab: () =>
      local(async () => (await store.all<VocabEntry>("vocab")).sort((a, b) => b.createdAt - a.createdAt), api.vocab),
    vocabGet: (word) => local(() => store.get<VocabEntry>("vocab", vocabKey(word)), () => api.vocabGet(word)),
    vocabGroups: () =>
      local(
        async () =>
          (await store.all<VocabGroup>("groups")).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
        api.vocabGroups,
      ),

    notes: () => local(async () => (await store.all<Note>("notes")).sort(newest), api.notes),
    note: (id) => local(async () => store.get<Note>("notes", await resolveNote(id)), () => api.note(id)),

    exercises: () => local(async () => (await library())?.exerciseSets, api.exercises),
    exercise: (id) => local(async () => (await library())?.exerciseSets.find((s) => s.id === id), () => api.exercise(id)),
    cheatsheets: () => local(async () => (await library())?.cheatsheets, api.cheatsheets),
    cheatsheet: (id) => local(async () => (await library())?.cheatsheets.find((s) => s.id === id), () => api.cheatsheet(id)),
    generatedItems: (setId) =>
      local(async () => (await store.get<ExerciseItem[]>("generated", setId)) ?? [], () => api.generatedItems(setId)),
    generatedCounts: () =>
      local(async () => {
        const sets = (await library())?.exerciseSets;
        if (!sets) return undefined;
        const counts: Record<string, number> = {};
        for (const s of sets) {
          const n = (await store.get<ExerciseItem[]>("generated", s.id))?.length ?? 0;
          if (n > 0) counts[s.id] = n;
        }
        return counts;
      }, api.generatedCounts),
    // Online only; the local copy follows at once so the set doesn't show them again before the next sync.
    async removeGeneratedItems(setId) {
      const r = await api.removeGeneratedItems(setId);
      if (await sync.hasData()) await store.put("generated", setId, []);
      return r;
    },
    async removeGeneratedItem(setId, itemId) {
      const r = await api.removeGeneratedItem(setId, itemId);
      const cur = await store.get<ExerciseItem[]>("generated", setId);
      if (cur) await store.put("generated", setId, cur.filter((i) => i.id !== itemId));
      return r;
    },

    progress: () => local(async () => (await stats())?.progress, api.progress),
    runs: (limit) => local(async () => (await stats())?.runs.slice(0, limit), () => api.runs(limit)),
    sheetViews: (limit) => local(async () => (await stats())?.sheetViews.slice(0, limit), () => api.sheetViews(limit)),
    exerciseProgress: (setId) =>
      local(
        async () => {
          const s = await stats();
          return s ? (s.exerciseProgress.find((p) => p.setId === setId) ?? null) : undefined;
        },
        () => api.exerciseProgress(setId),
      ),
    settings: () => local(async () => (await store.get<Settings>("meta", META.settings)) ?? undefined, api.settings),

    // --- practice ------------------------------------------------------------

    answer: (body) =>
      write(
        { type: "answer", at: nowS(), data: body },
        () => api.answer(body),
        (v) => recordAnswer(body, v),
        async () => {
          const item = await findItem(body.setId, body.itemId);
          if (!item) throw new Error("This exercise isn't available offline.");
          const v: AnswerVerdict = withoutTutor(gradeItem(item, body.response));
          await recordAnswer(body, v);
          return v;
        },
      ),
    finishRun: (setId, done) => {
      const mirror = async () => {
        if (done) await updateSession(setId, () => null);
      };
      return write(
        { type: "finish", data: { setId, done } },
        () => api.finishRun(setId, done),
        mirror,
        async () => (await mirror(), { ok: true as const }),
      );
    },
    saveExerciseProgress: (setId, body) => {
      const mirror = () => updateSession(setId, (p) => ({ ...p, index: body.index }));
      return write(
        { type: "exerciseProgressSave", setId, at: nowS(), data: body },
        () => api.saveExerciseProgress(setId, body),
        mirror,
        async () => (await mirror(), { ok: true as const }),
      );
    },
    clearExerciseProgress: (setId) => {
      const mirror = () => updateSession(setId, () => null);
      return write(
        { type: "exerciseProgressClear", setId, at: nowS() },
        () => api.clearExerciseProgress(setId),
        mirror,
        async () => (await mirror(), { ok: true as const }),
      );
    },
    recordSheetView: (sheetId, title) =>
      write(
        { type: "sheetView", data: { sheetId, title } },
        () => api.recordSheetView(sheetId, title),
        async () => {},
        async () => ({ ok: true as const }),
      ),

    // --- reading ---------------------------------------------------------------

    storyProgress: (id, progress) => {
      // Only forward, like the server; the status stays the server's until the next sync.
      const mirror = () => updateStory(id, (s) => void (s.progress = Math.max(s.progress, progress)));
      return write(
        { type: "storyProgress", storyId: id, progress, at: nowS() },
        () => api.storyProgress(id, progress),
        mirror,
        async () => (await mirror(), { ok: true as const }),
      );
    },
    markStoryRead: (id) => {
      const mirror = () =>
        updateStory(id, (s) => {
          s.readAt = nowS();
          s.status = "read";
          s.resumeAt = null;
        });
      return write(
        { type: "storyRead", storyId: id, read: true, at: nowS() },
        () => api.markStoryRead(id),
        mirror,
        async () => (await mirror(), { ok: true as const }),
      );
    },
    readStoryAgain: (id) => {
      const mirror = () =>
        updateStory(id, (s) => {
          s.readAt = null;
          s.progress = 0;
          s.status = "unread";
          s.resumeAt = null;
        });
      return write(
        { type: "storyRead", storyId: id, read: false, at: nowS() },
        () => api.readStoryAgain(id),
        mirror,
        async () => (await mirror(), { ok: true as const }),
      );
    },

    // --- vocab -----------------------------------------------------------------

    vocabSave: (body: SaveVocabBody) =>
      write(
        { type: "vocabSave", data: body },
        () => api.vocabSave(body),
        putVocab,
        async () => {
          // As the server saves it: keyed by vocabKey, forms replaced only when given.
          const word = vocabKey(body.word);
          const cur = await store.get<VocabEntry>("vocab", word);
          const given = Object.fromEntries(
            Object.entries(body.forms ?? {}).flatMap(([k, v]) => (typeof v === "string" && v.trim() ? [[k, v.trim()]] : [])),
          ) as Partial<Record<keyof NonNullable<VocabEntry["forms"]>, string>>;
          const forms = Object.keys(given).length
            ? {
                pos: given.pos ?? null,
                article: given.article ?? null,
                plural: given.plural ?? null,
                partizip2: given.partizip2 ?? null,
                auxiliary: given.auxiliary ?? null,
              }
            : (cur?.forms ?? null);
          const entry: VocabEntry = {
            word,
            display: (body.display ?? body.word).trim(),
            translation: body.translation,
            examples: body.examples,
            createdAt: cur?.createdAt ?? nowS(),
            groups: cur?.groups ?? [],
            stats: cur?.stats ?? null,
            forms,
          };
          await putVocab(entry);
          return entry;
        },
      ),
    vocabRemove: (word) =>
      write(
        { type: "vocabRemove", word },
        () => api.vocabRemove(word),
        () => removeVocabLocal(word),
        async () => (await removeVocabLocal(word), { ok: true as const }),
      ),
    studyVocab: (word, known) => {
      const put = async (stat: VocabStat) => {
        const e = await store.get<VocabEntry>("vocab", vocabKey(word));
        if (e) await putVocab({ ...e, stats: stat });
      };
      return write(
        { type: "vocabStudy", word, known },
        () => api.studyVocab(word, known),
        put,
        async () => {
          const s = (await store.get<VocabEntry>("vocab", vocabKey(word)))?.stats;
          const stat: VocabStat = {
            known: (s?.known ?? 0) + (known ? 1 : 0),
            missed: (s?.missed ?? 0) + (known ? 0 : 1),
            lastResult: known,
            lastStudiedAt: nowS(),
          };
          await put(stat);
          return stat;
        },
      );
    },

    // --- notes -----------------------------------------------------------------

    createNote: (body) => {
      const data = { title: body?.title ?? "Untitled", category: body?.category ?? "", body: body?.body ?? "" };
      return write(
        { type: "noteCreate", data },
        () => api.createNote(body),
        (n) => store.put("notes", n.id, n),
        async (opId) => {
          const at = nowS();
          const note: Note = { id: LOCAL_NOTE + opId, ...data, createdAt: at, updatedAt: at };
          await store.put("notes", note.id, note);
          await store.put("meta", META.localNote + opId, note.id);
          return note;
        },
      );
    },
    async saveNote(given: string, body: SaveNoteBody) {
      const create = isLocalNote(given) ? await pendingCreate(given) : undefined;
      const id = create ? given : await resolveNote(given);
      const cur = await store.get<Note>("notes", id);
      const edited = async (): Promise<Note> => {
        const n: Note = { ...(cur ?? { id, title: "Untitled", category: "", body: "", createdAt: nowS() }), ...body, updatedAt: nowS() };
        await store.put("notes", id, n);
        return n;
      };
      // Made offline: fold the edit into its queued create.
      if (create) {
        await store.replacePending(create.opId, { ...create, data: { ...create.data, ...body } });
        return edited();
      }
      // Already queued an edit: merge into it, keeping the version it started from.
      const queued = await pendingUpdate(id);
      if (queued) {
        await store.replacePending(queued.opId, { ...queued, data: { ...queued.data, ...body } });
        return edited();
      }
      return write(
        { type: "noteUpdate", id, baseUpdatedAt: cur?.updatedAt ?? 0, data: body },
        () => api.saveNote(id, body),
        (n) => store.put("notes", n.id, n),
        edited,
      );
    },
    async removeNote(given: string) {
      const create = isLocalNote(given) ? await pendingCreate(given) : undefined;
      const id = create ? given : await resolveNote(given);
      if (create) {
        // Never reached the server: forget it here.
        await store.replacePending(create.opId, null);
        await store.remove("meta", META.localNote + create.opId);
        await store.remove("notes", id);
        await sync.refreshPending();
        return { ok: true as const };
      }
      // Edits to a note being deleted needn't be sent (they'd only make a conflict copy).
      for (let q = await pendingUpdate(id); q; q = await pendingUpdate(id)) await store.replacePending(q.opId, null);
      return write(
        { type: "noteDelete", id },
        () => api.removeNote(id),
        () => store.remove("notes", id),
        async () => (await store.remove("notes", id), { ok: true as const }),
      );
    },
  };
}
