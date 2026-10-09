import { useEffect, useRef, useState } from "react";
import type { AskBody, ChatTurn } from "../api";
import { useApi } from "./context";

type Abort = { abort(): void; signal: { aborted: boolean } };
// AbortController exists in browsers and React Native; typed here without DOM libs.
const newAbort = (): Abort =>
  new (globalThis as unknown as { AbortController: new () => Abort }).AbortController();

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type TutorShot = { kind: "hint" | "translate"; text: string; busy: boolean; error?: string };
export type TutorChat = { msgs: ChatTurn[]; input: string; busy: boolean; error?: string };

function appendLast(msgs: ChatTurn[], t: string): ChatTurn[] {
  const copy = msgs.slice();
  const last = copy[copy.length - 1];
  if (last) copy[copy.length - 1] = { ...last, content: last.content + t };
  return copy;
}

/**
 * Inline AI help on one exercise item: a no-spoiler hint or a translation (a
 * one-shot answer), or "why was I wrong?" with follow-up questions (a chat).
 * Answers stream in; starting another request or closing cancels the last.
 */
export function useTutorChat({ item, response }: { item: NonNullable<AskBody["item"]>; response?: string }) {
  const api = useApi();
  const [shot, setShot] = useState<TutorShot | null>(null);
  const [chat, setChat] = useState<TutorChat | null>(null);
  const abortRef = useRef<Abort | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  function fresh() {
    abortRef.current?.abort();
    const c = newAbort();
    abortRef.current = c;
    return c;
  }

  function ask(kind: "hint" | "translate") {
    const c = fresh();
    setChat(null);
    setShot({ kind, text: "", busy: true });
    api
      .askAssistant(
        { task: kind === "hint" ? "hint" : "translate_exercise", item },
        (t) => setShot((s) => (s ? { ...s, text: s.text + t } : s)),
        c.signal,
      )
      .catch((e) => {
        if (!c.signal.aborted) setShot((s) => (s ? { ...s, error: msgOf(e), busy: false } : s));
      })
      .finally(() => setShot((s) => (s ? { ...s, busy: false } : s)));
  }

  function streamChat(body: AskBody, msgs: ChatTurn[]) {
    const c = fresh();
    setShot(null);
    setChat({ msgs: [...msgs, { role: "assistant", content: "" }], input: "", busy: true });
    api
      .askAssistant(body, (t) => setChat((s) => (s ? { ...s, msgs: appendLast(s.msgs, t) } : s)), c.signal)
      .catch((e) => {
        if (!c.signal.aborted) setChat((s) => (s ? { ...s, error: msgOf(e), busy: false } : s));
      })
      .finally(() => setChat((s) => (s ? { ...s, busy: false } : s)));
  }

  return {
    shot,
    chat,
    hint: () => ask("hint"),
    translate: () => ask("translate"),
    whyWrong: () => streamChat({ task: "why_wrong", item, response }, []),
    setInput: (input: string) => setChat((s) => (s ? { ...s, input } : s)),
    /** Send the typed follow-up question. */
    send() {
      if (!chat || !chat.input.trim() || chat.busy) return;
      const history: ChatTurn[] = [...chat.msgs, { role: "user", content: chat.input.trim() }];
      streamChat({ task: "chat", item, response, history }, history);
    },
    close() {
      abortRef.current?.abort();
      setShot(null);
      setChat(null);
    },
  };
}
