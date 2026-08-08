import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ExerciseItem, ExerciseSet } from "@mdb/shared";
import { ExerciseItemView } from "../components/ExerciseItemView";
import { TutorMarkdown } from "../components/TutorMarkdown";
import { api, askAssistant, type ChatTurn } from "../lib/api";
import { describeItem } from "../lib/describeItem";
import { useAsync } from "../lib/useAsync";

export function ExercisePlayer() {
  const { id } = useParams();
  const set = useAsync(() => api.exercise(id!), [id]);

  if (set.status === "loading")
    return <p className="text-slate-500">Loading…</p>;
  if (set.status === "error")
    return (
      <div>
        <p className="text-red-600">Exercise not found.</p>
        <Link to="/exercises" className="text-sm underline">
          ← Exercises
        </Link>
      </div>
    );

  return <Runner set={set.data} />;
}

function Runner({ set }: { set: ExerciseSet }) {
  const setId = set.id;
  const title = set.title;
  const [items, setItems] = useState<ExerciseItem[]>(set.items);
  const [index, setIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [lastCorrect, setLastCorrect] = useState(false);
  const [lastResponse, setLastResponse] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [llmGrading, setLlmGrading] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    // The tutor powers the Hint / Why-wrong buttons; llmGrading additionally
    // gates AI grading of free-text answers.
    Promise.all([api.assistantStatus(), api.settings()])
      .then(([st, se]) => {
        setAssistantEnabled(st.enabled);
        setLlmGrading(Boolean(st.enabled && se.llmGrading));
      })
      .catch(() => {});
  }, []);

  const item = items[index]!;

  function handleAnswered(correct: boolean, response?: string) {
    if (answered) return;
    setAnswered(true);
    setLastCorrect(correct);
    setLastResponse(response);
    if (correct) setCorrectCount((c) => c + 1);
    // Fire-and-forget; a failed save shouldn't block practice.
    void api.recordAttempt(setId, item.id, correct).catch(() => {});
  }

  function next() {
    if (index + 1 >= items.length) {
      setDone(true);
    } else {
      setIndex((i) => i + 1);
      setAnswered(false);
      setLastResponse(undefined);
    }
  }

  async function generateMore() {
    setGenBusy(true);
    setGenError(null);
    const startAt = items.length;
    try {
      const res = await api.generateMore({
        count: 3,
        set: {
          title: set.title,
          level: set.level,
          tags: set.tags,
          types: [...new Set(set.items.map((i) => i.type))],
          samples: set.items.slice(0, 3),
        },
      });
      if (res.items.length === 0) {
        setGenError("The tutor couldn't produce valid items — try again.");
        return;
      }
      setItems((cur) => [...cur, ...res.items]);
      setIndex(startAt);
      setAnswered(false);
      setLastResponse(undefined);
      setDone(false);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenBusy(false);
    }
  }

  // Once an item is resolved, Enter advances — unless you're typing in a live
  // field (e.g. the tutor chat) or a button is focused (it handles Enter itself).
  useEffect(() => {
    if (!answered) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const typing =
        (tag === "INPUT" || tag === "TEXTAREA") &&
        !(el as HTMLInputElement | null)?.disabled;
      if (typing || tag === "BUTTON") return;
      e.preventDefault();
      next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, index, items.length]);

  // On mobile, auto-advance after a correct answer (with a short pause so the
  // result registers). Wrong answers wait — you may want to read the answer or
  // ask the tutor. On desktop, Enter advances (above); nothing is automatic.
  useEffect(() => {
    if (!answered || !mobile || !lastCorrect) return;
    const t = setTimeout(() => next(), 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, mobile, lastCorrect, index]);

  if (done) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="mb-2 text-2xl font-bold">Done! 🎉</h1>
        <p className="mb-6 text-slate-500">
          {correctCount} / {items.length} correct
        </p>
        {assistantEnabled && (
          <div className="mb-4">
            <button
              type="button"
              onClick={generateMore}
              disabled={genBusy}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 font-medium hover:border-slate-500 disabled:opacity-50 dark:border-slate-700"
            >
              {genBusy ? "Generating…" : "✨ Generate 3 more like these"}
            </button>
            {genError && <p className="mt-2 text-sm text-red-600">{genError}</p>}
          </div>
        )}
        <Link
          to="/exercises"
          className="inline-block rounded-lg bg-accent px-4 py-2 text-accent-foreground"
        >
          Back to exercises
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-1 flex items-center justify-between gap-2 text-sm text-slate-500">
        <Link to="/exercises" className="hover:underline">
          ← {title}
        </Link>
        <span className="shrink-0">
          {index + 1} / {items.length}
        </span>
      </div>
      {set.subtitle && (
        <p className="mb-4 text-xs text-slate-400">{set.subtitle}</p>
      )}
      <div className="mb-6 h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${((index + (answered ? 1 : 0)) / items.length) * 100}%` }}
        />
      </div>

      <div
        className={`rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 ${
          answered ? (lastCorrect ? "animate-correct" : "animate-wrong") : ""
        }`}
      >
        <ExerciseItemView
          key={item.id}
          item={item}
          onAnswered={handleAnswered}
          llmGrading={llmGrading}
        />
      </div>

      {assistantEnabled && (
        <TutorHelp
          key={item.id}
          item={item}
          answered={answered}
          lastCorrect={lastCorrect}
          lastResponse={lastResponse}
        />
      )}

      {answered && (
        <button
          type="button"
          onClick={next}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground"
        >
          {index + 1 >= items.length ? "Finish" : "Next"}
        </button>
      )}
    </div>
  );
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const chipCls =
  "rounded-full border border-slate-300 px-3 py-1 text-xs hover:border-slate-500 dark:border-slate-700";

type OneShot = { kind: "hint" | "translate"; text: string; busy: boolean; error?: string };
type Chat = { msgs: ChatTurn[]; input: string; busy: boolean; error?: string };

/** Inline AI help: no-spoiler Hint, Translate, and a chat when you got it wrong. */
function TutorHelp({
  item,
  answered,
  lastCorrect,
  lastResponse,
}: {
  item: ExerciseItem;
  answered: boolean;
  lastCorrect: boolean;
  lastResponse?: string;
}) {
  const [shot, setShot] = useState<OneShot | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const showWhyWrong = answered && !lastCorrect && lastResponse !== undefined;
  const desc = describeItem(item);

  function fresh() {
    abortRef.current?.abort();
    const c = new AbortController();
    abortRef.current = c;
    return c;
  }

  function appendLast(msgs: ChatTurn[], t: string): ChatTurn[] {
    const copy = msgs.slice();
    const last = copy[copy.length - 1];
    if (last) copy[copy.length - 1] = { ...last, content: last.content + t };
    return copy;
  }

  function runShot(kind: "hint" | "translate") {
    const c = fresh();
    setChat(null);
    setShot({ kind, text: "", busy: true });
    askAssistant(
      { task: kind === "hint" ? "hint" : "translate_exercise", item: desc },
      (t) => setShot((s) => (s ? { ...s, text: s.text + t } : s)),
      c.signal,
    )
      .catch((e) => {
        if (!c.signal.aborted)
          setShot((s) => (s ? { ...s, error: msgOf(e), busy: false } : s));
      })
      .finally(() => setShot((s) => (s ? { ...s, busy: false } : s)));
  }

  function startWhyWrong() {
    const c = fresh();
    setShot(null);
    setChat({ msgs: [{ role: "assistant", content: "" }], input: "", busy: true });
    askAssistant(
      { task: "why_wrong", item: desc, response: lastResponse },
      (t) => setChat((s) => (s ? { ...s, msgs: appendLast(s.msgs, t) } : s)),
      c.signal,
    )
      .catch((e) => {
        if (!c.signal.aborted)
          setChat((s) => (s ? { ...s, error: msgOf(e), busy: false } : s));
      })
      .finally(() => setChat((s) => (s ? { ...s, busy: false } : s)));
  }

  function sendFollowup() {
    if (!chat || !chat.input.trim() || chat.busy) return;
    const history: ChatTurn[] = [
      ...chat.msgs,
      { role: "user", content: chat.input.trim() },
    ];
    const c = fresh();
    setChat({
      msgs: [...history, { role: "assistant", content: "" }],
      input: "",
      busy: true,
    });
    askAssistant(
      { task: "chat", item: desc, response: lastResponse, history },
      (t) => setChat((s) => (s ? { ...s, msgs: appendLast(s.msgs, t) } : s)),
      c.signal,
    )
      .catch((e) => {
        if (!c.signal.aborted)
          setChat((s) => (s ? { ...s, error: msgOf(e), busy: false } : s));
      })
      .finally(() => setChat((s) => (s ? { ...s, busy: false } : s)));
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => runShot("hint")} className={chipCls}>
          💡 Hint
        </button>
        <button type="button" onClick={() => runShot("translate")} className={chipCls}>
          🌐 Translate
        </button>
        {showWhyWrong && (
          <button type="button" onClick={startWhyWrong} className={chipCls}>
            Why was I wrong?
          </button>
        )}
      </div>

      {shot && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
          {shot.error ? (
            <span className="text-sm text-red-600">{shot.error}</span>
          ) : (
            <TutorMarkdown text={shot.text} busy={shot.busy} />
          )}
        </div>
      )}

      {chat && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
          {chat.msgs.map((m, i) =>
            m.role === "assistant" ? (
              <TutorMarkdown
                key={i}
                text={m.content}
                busy={chat.busy && i === chat.msgs.length - 1}
              />
            ) : (
              <div
                key={i}
                className="max-w-[85%] self-end rounded-lg bg-slate-200 px-3 py-1.5 text-sm dark:bg-slate-700"
              >
                {m.content}
              </div>
            ),
          )}
          {chat.error && <p className="text-sm text-red-600">{chat.error}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendFollowup();
            }}
            className="flex gap-2 pt-1"
          >
            <input
              value={chat.input}
              onChange={(e) =>
                setChat((s) => (s ? { ...s, input: e.target.value } : s))
              }
              placeholder="Ask a follow-up…"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-slate-700"
            />
            <button
              type="submit"
              disabled={chat.busy || !chat.input.trim()}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
