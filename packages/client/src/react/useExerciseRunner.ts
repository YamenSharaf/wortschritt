import { useEffect, useMemo, useRef, useState } from "react";
import {
  responseText,
  type AnswerVerdict,
  type ExerciseItem,
  type ExerciseProgress,
  type ExerciseRun,
  type ExerciseSet,
  type ItemResponse,
} from "@mdb/shared";
import { useApi } from "./context";
import { useAsync } from "./useAsync";

/** A set with the learner's generated items and resume point, ready to run. */
export function useExerciseSet(id: string) {
  const api = useApi();
  const set = useAsync(() => api.exercise(id), [id]);
  // Resume where the learner left off (null if none / on error).
  const progress = useAsync(() => api.exerciseProgress(id).catch(() => null), [id]);
  // Items the server generated for this learner earlier ("generate more").
  const extra = useAsync(() => api.generatedItems(id).catch(() => []), [id]);
  if (set.status === "loading" || progress.status === "loading" || extra.status === "loading")
    return { status: "loading" as const };
  if (set.status === "error") return { status: "error" as const, error: set.error };
  return {
    status: "ready" as const,
    set: set.data,
    extra: extra.status === "ready" ? extra.data : [],
    initial: progress.status === "ready" ? progress.data : null,
  };
}

/**
 * One pass through an exercise set: the current item, this run's results,
 * answering (graded by the server), moving around, finishing, and generating
 * more items. The UI only renders it; keys, focus and timing are its own.
 */
export function useExerciseRunner({
  set,
  extra,
  initial,
}: {
  set: ExerciseSet;
  extra: ExerciseItem[];
  initial: ExerciseProgress | null;
}) {
  const api = useApi();
  const setId = set.id;
  const [items, setItems] = useState<ExerciseItem[]>(() => [...set.items, ...extra]);
  const [index, setIndex] = useState(() =>
    initial ? Math.min(Math.max(0, initial.index), set.items.length + extra.length - 1) : 0,
  );
  // Per-item correctness / responses for THIS run, keyed by item id. Drives the
  // live score, the question navigator, and the run recorded at the end.
  const [results, setResults] = useState<Record<string, boolean>>(() => {
    if (!initial) return {};
    const ids = new Set([...set.items, ...extra].map((i) => i.id));
    return Object.fromEntries(Object.entries(initial.results).filter(([k]) => ids.has(k)));
  });
  const [responses, setResponses] = useState<Record<string, string | undefined>>(() =>
    initial ? { ...initial.responses } : {},
  );
  // Whether the current *visit* of the current item has been answered. Resets on
  // navigation so revisiting an item re-opens it for another attempt.
  const [answered, setAnswered] = useState(false);
  const [lastCorrect, setLastCorrect] = useState(false);
  const [lastResponse, setLastResponse] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const [prevRun, setPrevRun] = useState<ExerciseRun | null>(null);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genCount, setGenCount] = useState(5);
  /** When the current item was answered (ms since epoch); 0 before. */
  const answeredAt = useRef(0);

  const correctCount = useMemo(() => Object.values(results).filter(Boolean).length, [results]);
  const answeredCount = Object.keys(results).length;

  useEffect(() => {
    // The tutor powers the Hint / Why-wrong buttons (the server decides
    // whether it also grades free-text answers).
    Promise.all([api.assistantStatus(), api.settings()])
      .then(([st, se]) => {
        setAssistantEnabled(st.enabled);
        setGenCount(se.generateCount);
      })
      .catch(() => {});
  }, [api]);

  // The previous run's per-item results — shown as faint hints in the navigator.
  useEffect(() => {
    api.run(setId).then(setPrevRun).catch(() => {});
  }, [api, setId]);

  const item = items[index]!;

  // Leaving partway records a run too (the server scores it from the answers
  // it graded, once per change), so the last score survives a reload.
  // A finished run was recorded already (until "generate more" reopens it).
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(
    () => () => {
      if (!doneRef.current && Object.keys(resultsRef.current).length > 0)
        void api.finishRun(setId, false).catch(() => {});
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The resume point; the answers themselves reach the server's session as
  // they're graded.
  function saveProgress(i: number) {
    const position = Math.min(Math.max(0, i), items.length - 1);
    void api.saveExerciseProgress(setId, { index: position }).catch(() => {});
  }

  /** Grade on the server, then update this run's live state. */
  async function submit(response: ItemResponse): Promise<AnswerVerdict> {
    const v = await api.answer({ setId, itemId: item.id, response });
    handleAnswered(v.correct, responseText(item, response));
    return v;
  }

  function handleAnswered(correct: boolean, response: string) {
    if (answered) return;
    answeredAt.current = Date.now();
    setAnswered(true);
    setLastCorrect(correct);
    setLastResponse(response);
    setResults((r) => ({ ...r, [item.id]: correct }));
    setResponses((r) => ({ ...r, [item.id]: response }));
  }

  function goTo(i: number) {
    if (i < 0 || i >= items.length) return;
    setIndex(i);
    setAnswered(false);
    setLastResponse(undefined);
    saveProgress(i);
  }

  function next() {
    if (index + 1 >= items.length) {
      doneRef.current = true;
      void api.finishRun(setId, true).catch(() => {});
      setDone(true);
    } else {
      goTo(index + 1);
    }
  }

  async function generateMore() {
    setGenBusy(true);
    setGenError(null);
    const startAt = items.length;
    try {
      // The server writes them (learning from your mistakes) and keeps them.
      const res = await api.generateMore(setId, genCount);
      if (res.items.length === 0) {
        setGenError(
          res.received > 0
            ? `The tutor returned ${res.received} item${res.received === 1 ? "" : "s"} but ${res.received === 1 ? "it wasn't" : "none were"} valid — try again.`
            : "The tutor didn't return any exercises — try again.",
        );
        return;
      }
      setItems((cur) => [...cur, ...res.items]);
      setIndex(startAt);
      setAnswered(false);
      setLastResponse(undefined);
      setDone(false);
    } catch (e) {
      setGenError(`Couldn't reach the tutor: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenBusy(false);
    }
  }

  const extraCount = items.length - set.items.length;
  /** Drop items from this run (their answers too, as the server does). */
  function dropItems(ids: Set<string>) {
    const left = items.filter((i) => !ids.has(i.id));
    const without = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => !ids.has(k)));
    setItems(left);
    setResults(without);
    setResponses(without);
    setIndex((i) => Math.min(i, left.length - 1));
    setAnswered(false);
    setLastResponse(undefined);
  }
  async function removeExtras() {
    await api.removeGeneratedItems(setId);
    dropItems(new Set(items.slice(set.items.length).map((i) => i.id)));
  }
  /** Whether an item was generated for this learner (only those can be removed). */
  const isGenerated = (id: string) => !set.items.some((i) => i.id === id);
  /** Remove one generated item; the run stays on the item that takes its place. */
  async function removeItem(id: string) {
    if (!isGenerated(id)) return;
    await api.removeGeneratedItem(setId, id);
    dropItems(new Set([id]));
  }

  return {
    items,
    index,
    item,
    results,
    responses,
    /** This run's earlier result for the current item, if any. */
    priorResult: results[item.id] as boolean | undefined,
    answered,
    answeredAt,
    lastCorrect,
    lastResponse,
    done,
    prevRun,
    assistantEnabled,
    correctCount,
    answeredCount,
    isLast: index + 1 >= items.length,
    submit,
    goTo,
    next,
    extraCount,
    removeExtras,
    isGenerated,
    removeItem,
    generate: { busy: genBusy, error: genError, count: genCount, setCount: setGenCount, run: generateMore },
  };
}
