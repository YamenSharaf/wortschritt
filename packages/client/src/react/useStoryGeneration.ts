import { useEffect, useRef, useState } from "react";
import type { CefrLevel, GenerateStoryBody, StoryContext } from "@mdb/shared";
import type { StoryGenerationEvent } from "../api";
import { useApi } from "./context";

type Abort = { abort(): void; signal: { aborted: boolean } };
// AbortController exists in browsers and React Native; typed here without DOM libs.
const newAbort = (): Abort =>
  new (globalThis as unknown as { AbortController: new () => Abort }).AbortController();

export type StoryGenerationProgress = StoryGenerationEvent | "starting";

/** What the learner sees while a story is being written. */
export function storyProgressText(p: StoryGenerationProgress | null): string {
  if (p === "starting" || p === null) return "Starting…";
  if (p.phase === "writing") return `Writing… ${p.chars.toLocaleString()} characters`;
  if (p.phase === "fixing") return `Fixing ${p.problems === 1 ? "a problem" : `${p.problems} problems`} in the result…`;
  return "Checking the story…";
}

/**
 * "Write me a story about …": the options (level from the learner's settings,
 * what to keep in mind, with a preview of it), then the server writes and
 * saves the story while reporting progress. Cancelled on unmount.
 */
export function useStoryGeneration() {
  const api = useApi();
  /** null until known: whether the learner has an AI tutor set up. */
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState("");
  const [level, setLevel] = useState<CefrLevel>("A2");
  const [length, setLength] = useState<GenerateStoryBody["length"]>("medium");
  const [questions, setQuestions] = useState(4);
  const [vocabulary, setVocabulary] = useState<GenerateStoryBody["vocabulary"]>("known");
  const [context, setContext] = useState<GenerateStoryBody["context"]>({ mistakes: true, vocab: true, topics: false });
  const [preview, setPreview] = useState<StoryContext | null>(null);
  const [progress, setProgress] = useState<StoryGenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<Abort | null>(null);

  useEffect(() => {
    Promise.all([api.assistantStatus(), api.settings()])
      .then(([st, se]) => {
        setAiReady(st.enabled);
        setLevel(se.level);
      })
      .catch(() => setAiReady(false));
    // Everything that could be included; the options pick from it.
    api.storyContext({ mistakes: true, vocab: true, topics: true }).then(setPreview).catch(() => {});
    return () => abort.current?.abort();
  }, [api]);

  return {
    aiReady,
    prompt,
    setPrompt,
    level,
    setLevel,
    length,
    setLength,
    questions,
    setQuestions,
    vocabulary,
    setVocabulary,
    context,
    setContext,
    preview,
    progress,
    busy: progress !== null,
    error,
    canStart: prompt.trim().length >= 3 && aiReady !== null && progress === null,
    /** Write and save the story; resolves with its id (null if it failed or was cancelled). */
    async start(): Promise<string | null> {
      setError(null);
      setProgress("starting");
      const c = newAbort();
      abort.current = c;
      try {
        const { id } = await api.generateStory(
          { prompt: prompt.trim(), level, length, questions, vocabulary, context },
          setProgress,
          c.signal,
        );
        return id;
      } catch (e) {
        if (c.signal.aborted) return null;
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setProgress(null);
        return null;
      }
    },
    cancel() {
      abort.current?.abort();
      setProgress(null);
    },
  };
}
