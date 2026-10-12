import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { storySetId, type SyncChanges, type SyncOp, type SyncPushResult, type SyncStats, type SyncStory } from "@mdb/shared";
import { builtInIds, loadCheatsheets, loadExerciseSets } from "../content/loader";
import { db, schema } from "../db/client";
import {
  clearExerciseProgress,
  getExerciseProgress,
  latestRunsPerSet,
  listExerciseProgress,
  recentSheetViews,
  recordSheetView,
  saveExerciseProgress,
} from "./activity";
import { getStoredCover, coverVersion } from "./covers";
import { createNote, getNote, listNotes, removeNote, updateNote } from "./notes";
import { AnswerError, answerOffline, finish } from "./answers";
import { listFavorites, setFavorite } from "./favorites";
import { allGenerated, listGenerated } from "./generated";
import { getProgressSummary } from "./progress";
import { getSeriesView, listSeries } from "./series";
import { getSettings } from "./settings";
import { advanceStoryProgress, getStory, listStories, setStoryRead, wordCount } from "./stories";
import { getStoryTranslations } from "./storyTranslations";
import { getVocab, listGroups, listVocab, recordStudy, removeVocab, upsertVocab } from "./vocab";

/**
 * Sync for the native app (offline-first). Changes: triggers write every
 * change to a learner's items into sync_log (kind + id, see migration 14);
 * a sync returns the current state of each item changed since the app's
 * cursor, or marks it deleted when it's gone. The shared library is small,
 * so it's sent whole whenever its version differs. Push: actions the app did
 * offline, applied once per op id (sync_ops) and merged safely; answers are
 * graded here by the item's own rules (no AI tutor, like the app's offline
 * verdict). Stats (the
 * daily goal, latest runs, where you stopped) are computed here and sent on
 * every pull, so the app shows them without any logic of its own.
 */

const PAGE = 1000;
const LOG_DAYS = 90;
const OPS_DAYS = 30;
const HORIZON_KEY = "sync.horizon";

type Kind = "story" | "series" | "vocab" | "group" | "note" | "settings" | "generated" | "favorites";

function horizon(): number {
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, HORIZON_KEY)).get();
  return row ? Number(row.value) || 0 : 0;
}

function lastSeq(): number {
  const row = db.get<{ seq: number | null }>(sql`SELECT max(seq) AS seq FROM sync_log`);
  return row?.seq ?? 0;
}

// The library's version: a hash of every set and sheet (built-in + imported;
// a few hundred kB, so hashing it per sync is cheap).
function library(): NonNullable<SyncChanges["library"]> {
  const exerciseSets = loadExerciseSets();
  const cheatsheets = loadCheatsheets();
  const builtIn = [...builtInIds("exercise"), ...builtInIds("cheatsheet")];
  const version = createHash("sha256").update(JSON.stringify([exerciseSets, cheatsheets, builtIn])).digest("hex").slice(0, 16);
  return { version, exerciseSets, cheatsheets, builtIn };
}

function syncStory(userId: number, id: string): SyncStory | null {
  const view = getStory(userId, id);
  if (!view) return null;
  return {
    ...view,
    cover: coverVersion(getStoredCover(userId, "story", id)),
    translations: getStoryTranslations(userId, id),
    words: wordCount(view.story.body),
  };
}

const SHEET_VIEWS = 50;

/** The learner's numbers as the web shows them, computed now. */
function stats(userId: number): SyncStats {
  return {
    progress: getProgressSummary(userId),
    runs: latestRunsPerSet(userId),
    sheetViews: recentSheetViews(userId, SHEET_VIEWS),
    // Practice sets only: a story's quiz session isn't something to resume.
    exerciseProgress: listExerciseProgress(userId).filter((p) => !p.setId.startsWith(storySetId(""))),
  };
}

const emptyDeleted = (): SyncChanges["deleted"] => ({ stories: [], series: [], vocab: [], groups: [], notes: [], generated: [] });

/** Everything this learner has, for a first sync (or one after a long time offline). */
function snapshot(userId: number, cursor: number): SyncChanges {
  return {
    cursor: String(cursor),
    full: true,
    more: false,
    library: library(),
    stories: listStories(userId).flatMap((s) => syncStory(userId, s.id) ?? []),
    series: listSeries(userId).flatMap((s) => getSeriesView(userId, s.id) ?? []),
    vocab: listVocab(userId),
    groups: listGroups(userId),
    notes: listNotes(userId),
    generated: [...allGenerated(userId)].map(([setId, items]) => ({ setId, items })),
    settings: getSettings(userId),
    favorites: listFavorites(userId),
    deleted: emptyDeleted(),
    stats: stats(userId),
  };
}

/** Changes since `since` (a cursor from an earlier sync), or a full snapshot. */
export function syncChanges(userId: number, since: number | null, libraryVersion: string | undefined): SyncChanges {
  // Read the cursor first: anything written after this shows up next time.
  const now = lastSeq();
  if (since === null || since < horizon()) return snapshot(userId, now);

  const rows = db.all<{ kind: Kind; itemId: string; seq: number }>(sql`
    SELECT kind, item_id AS itemId, max(seq) AS seq FROM sync_log
    WHERE user_id = ${userId} AND seq > ${since} AND seq <= ${now}
    GROUP BY kind, item_id ORDER BY seq LIMIT ${PAGE}
  `);
  const more = rows.length === PAGE;
  const cursor = more ? rows.at(-1)!.seq : Math.max(since, now);

  const out: SyncChanges = {
    cursor: String(cursor),
    full: false,
    more,
    library: null,
    stories: [],
    series: [],
    vocab: [],
    groups: [],
    notes: [],
    generated: [],
    settings: null,
    favorites: null,
    deleted: emptyDeleted(),
    stats: stats(userId),
  };
  const lib = library();
  if (lib.version !== libraryVersion) out.library = lib;

  const seriesIds = new Set<string>();
  const seriesLogged = new Set<string>();
  let groupsList: ReturnType<typeof listGroups> | null = null;
  for (const { kind, itemId } of rows) {
    switch (kind) {
      case "story": {
        const s = syncStory(userId, itemId);
        if (s) out.stories.push(s);
        else out.deleted.stories.push(itemId);
        // A chapter's change (progress, title, deletion) changes its book too.
        const sid = s?.series?.id ?? itemId.replace(/-\d{2,}$/, "");
        if (s?.series || sid !== itemId) seriesIds.add(sid);
        break;
      }
      case "series":
        seriesIds.add(itemId);
        seriesLogged.add(itemId);
        break;
      case "vocab": {
        const v = getVocab(userId, itemId);
        if (v) out.vocab.push(v);
        else out.deleted.vocab.push(itemId);
        break;
      }
      case "group": {
        groupsList ??= listGroups(userId);
        const g = groupsList.find((x) => String(x.id) === itemId);
        if (g) out.groups.push(g);
        else out.deleted.groups.push(itemId);
        break;
      }
      case "note": {
        const n = getNote(userId, itemId);
        if (n) out.notes.push(n);
        else out.deleted.notes.push(itemId);
        break;
      }
      case "settings":
        out.settings = getSettings(userId);
        break;
      case "favorites":
        out.favorites = listFavorites(userId);
        break;
      case "generated": {
        const items = listGenerated(userId, itemId);
        if (items.length > 0) out.generated.push({ setId: itemId, items });
        else out.deleted.generated.push(itemId);
        break;
      }
    }
  }
  for (const id of seriesIds) {
    const v = getSeriesView(userId, id);
    if (v) out.series.push(v);
    // Gone, and it was a book that changed (not just a guess from a chapter id).
    else if (seriesLogged.has(id)) out.deleted.series.push(id);
  }
  return out;
}

// --- push -------------------------------------------------------------------

type Result = SyncPushResult["results"][number];

function apply(userId: number, op: SyncOp): Omit<Result, "opId" | "duplicate"> {
  switch (op.type) {
    case "answer":
      try {
        answerOffline(userId, op.data, Math.min(op.at, Math.floor(Date.now() / 1000)));
        return { ok: true };
      } catch (err) {
        // Gone or mismatched for good: report it rather than retry forever.
        if (err instanceof AnswerError) return { ok: false, error: err.message };
        throw err;
      }
    case "finish":
      return finish(userId, op.data.setId, op.data.done) ? { ok: true } : { ok: false, error: "No such exercise set." };
    case "sheetView":
      recordSheetView(userId, op.data);
      return { ok: true };
    case "storyProgress":
    case "storyRead": {
      // Progress only moves forward, whichever device read further; read
      // state changes apply in time order (an older one is stale).
      const at = Math.min(op.at, Math.floor(Date.now() / 1000));
      const r = op.type === "storyProgress" ? advanceStoryProgress(userId, op.storyId, op.progress, at) : setStoryRead(userId, op.storyId, op.read, at);
      if (r === "missing") return { ok: false, error: "no such story" };
      return r === "stale" ? { ok: true, stale: true } : { ok: true };
    }
    case "favorite":
      // An older change than the one already there is stale: the newer one stands.
      return setFavorite(userId, op.kind, op.id, op.on, Math.min(op.at, Math.floor(Date.now() / 1000))) ? { ok: true } : { ok: true, stale: true };
    case "vocabSave":
      upsertVocab(userId, op.data);
      return { ok: true };
    case "vocabRemove":
      removeVocab(userId, op.word);
      return { ok: true };
    case "vocabStudy":
      if (!getVocab(userId, op.word)) return { ok: false, error: "no such word" };
      recordStudy(userId, op.word, op.known);
      return { ok: true };
    case "noteCreate":
      return { ok: true, noteId: createNote(userId, op.data).id };
    case "noteUpdate": {
      const current = getNote(userId, op.id);
      if (!current) {
        // Deleted elsewhere: keep the app's text as a new note rather than lose it.
        const note = createNote(userId, {
          title: op.data.title ?? "Untitled",
          category: op.data.category ?? "",
          body: op.data.body ?? "",
        });
        return { ok: true, noteId: note.id, conflict: true };
      }
      if (current.updatedAt > op.baseUpdatedAt) {
        // Changed on another device too: keep both.
        const copy = createNote(userId, {
          title: `${op.data.title ?? current.title} (conflict copy)`.slice(0, 200),
          category: op.data.category ?? current.category,
          body: op.data.body ?? current.body,
        });
        return { ok: true, noteId: copy.id, conflict: true };
      }
      updateNote(userId, op.id, op.data);
      return { ok: true, noteId: op.id };
    }
    case "noteDelete":
      removeNote(userId, op.id);
      return { ok: true };
    case "exerciseProgressSave":
    case "exerciseProgressClear": {
      // A clock ahead of the server's can't make an old action win later.
      const at = Math.min(op.at, Math.floor(Date.now() / 1000));
      const current = getExerciseProgress(userId, op.setId);
      if (current && current.updatedAt > at) return { ok: true, stale: true };
      if (op.type === "exerciseProgressSave") saveExerciseProgress(userId, op.setId, op.data, at);
      else clearExerciseProgress(userId, op.setId);
      return { ok: true };
    }
  }
}

/** Apply the app's offline actions in order; each op id only once. */
export function syncPush(userId: number, ops: SyncOp[]): SyncPushResult {
  const results: Result[] = [];
  for (const op of ops) {
    const done = db
      .select()
      .from(schema.syncOps)
      .where(and(eq(schema.syncOps.userId, userId), eq(schema.syncOps.opId, op.opId)))
      .get();
    if (done) {
      results.push({ ...(JSON.parse(done.result) as Omit<Result, "opId" | "duplicate">), opId: op.opId, duplicate: true });
      continue;
    }
    let result: Omit<Result, "opId" | "duplicate">;
    try {
      result = db.transaction(() => {
        const r = apply(userId, op);
        db.insert(schema.syncOps).values({ userId, opId: op.opId, result: JSON.stringify(r) }).run();
        return r;
      });
    } catch (err) {
      // Not recorded: a retry may succeed (e.g. after a server fix).
      result = { ok: false, error: err instanceof Error ? err.message : "failed" };
    }
    results.push({ ...result, opId: op.opId, duplicate: false });
  }
  return { results };
}

/** Drop old log entries (moving the horizon), logs of deleted users, and old op ids. */
export function pruneSync(): void {
  const cutoff = Math.floor(Date.now() / 1000) - LOG_DAYS * 86_400;
  const old = db.get<{ seq: number | null }>(sql`SELECT max(seq) AS seq FROM sync_log WHERE at < ${cutoff}`);
  if (old?.seq) {
    db.delete(schema.syncLog).where(lt(schema.syncLog.seq, old.seq + 1)).run();
    db.insert(schema.appSettings)
      .values({ key: HORIZON_KEY, value: String(old.seq) })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: String(old.seq) } })
      .run();
  }
  db.run(sql`DELETE FROM sync_log WHERE user_id NOT IN (SELECT id FROM users)`);
  db.delete(schema.syncOps)
    .where(lt(schema.syncOps.createdAt, Math.floor(Date.now() / 1000) - OPS_DAYS * 86_400))
    .run();
}
