import { useMemo, useState } from "react";
import {
  gradeText,
  isCanonical,
  modelAnswer,
  type ExerciseItem,
  type TextAnswer,
} from "@mdb/shared";
import { api } from "../lib/api";

/**
 * German answers are often mid-sentence and lowercase (verbs like "geht",
 * "muss"), so stop mobile keyboards from forcing a capital or "correcting"
 * German words. The learner can still type capitals when needed (nouns, etc.).
 */
const answerInputProps = {
  autoCapitalize: "none",
  autoCorrect: "off",
  autoComplete: "off",
  spellCheck: false,
  lang: "de",
} as const;

type Props = {
  item: ExerciseItem;
  /** Called exactly once when the learner resolves the item. */
  onAnswered: (correct: boolean, response?: string) => void;
  /** Whether to consult the AI tutor when local grading misses. */
  llmGrading?: boolean;
};

/**
 * One renderer per exercise type. Adding a new interactive type = add a case
 * here + a schema in @mdb/shared. Everything else stays data.
 */
export function ExerciseItemView({ item, onAnswered, llmGrading }: Props) {
  switch (item.type) {
    case "multiple_choice":
      return <MultipleChoice item={item} onAnswered={onAnswered} />;
    case "cloze":
      return <Cloze item={item} onAnswered={onAnswered} />;
    case "flashcard":
      return <Flashcard item={item} onAnswered={onAnswered} />;
    case "sentence_build":
      return (
        <SentenceBuild item={item} onAnswered={onAnswered} llmGrading={llmGrading} />
      );
    case "transform":
      return (
        <Transform item={item} onAnswered={onAnswered} llmGrading={llmGrading} />
      );
    case "true_false":
      return <TrueFalse item={item} onAnswered={onAnswered} />;
    case "conjugation_table":
      return <ConjugationTable item={item} onAnswered={onAnswered} />;
  }
}

// --- shared bits -----------------------------------------------------------

function Instructions({ text }: { text?: string }) {
  if (!text) return null;
  // A left rule + muted style marks this as the task directive so it reads as
  // guidance, not as part of the exercise sentence below it.
  return (
    <p className="mb-4 border-l-2 border-slate-200 pl-3 text-sm italic text-slate-500 dark:border-slate-700">
      {text}
    </p>
  );
}

/** Always-visible helper text on an item (e.g. the words to use). */
function ItemHint({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="mb-3 text-sm">
      <span className="rounded bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {text}
      </span>
    </p>
  );
}

function Explanation({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="mt-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {text}
    </p>
  );
}

/**
 * Grade a free-text answer: local first, then the tutor on a miss (if enabled).
 * Always returns the model answer to reveal.
 */
async function checkFreeText(
  input: string,
  answer: TextAnswer,
  opts: { llmGrading?: boolean; prompt?: string },
): Promise<{ correct: boolean; feedback?: string }> {
  if (gradeText(input, answer)) return { correct: true };
  if (opts.llmGrading) {
    try {
      const v = await api.gradeAnswer({
        prompt: opts.prompt,
        expected: answer.accept,
        response: input,
      });
      return { correct: v.correct, feedback: v.feedback || undefined };
    } catch {
      /* fall back to the local miss */
    }
  }
  return { correct: false };
}

// --- multiple choice -------------------------------------------------------

function MultipleChoice({
  item,
  onAnswered,
}: {
  item: Extract<ExerciseItem, { type: "multiple_choice" }>;
  onAnswered: (c: boolean, response?: string) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;

  return (
    <div>
      <Instructions text={item.instructions} />
      <ItemHint text={item.hint} />
      <p className="mb-4 text-lg">{item.prompt}</p>
      <div className="grid gap-2">
        {item.choices.map((choice, i) => {
          const state = !done
            ? "idle"
            : i === item.answerIndex
              ? "correct"
              : i === picked
                ? "wrong"
                : "idle";
          return (
            <button
              key={i}
              type="button"
              disabled={done}
              onClick={() => {
                setPicked(i);
                onAnswered(i === item.answerIndex, item.choices[i]);
              }}
              className={`rounded-lg border px-4 py-2 text-left ${
                state === "correct"
                  ? "border-green-500 bg-green-50 dark:bg-green-950"
                  : state === "wrong"
                    ? "border-red-500 bg-red-50 dark:bg-red-950"
                    : "border-slate-300 hover:border-slate-500 dark:border-slate-700"
              }`}
            >
              {choice}
            </button>
          );
        })}
      </div>
      {done && <Explanation text={item.explanation} />}
    </div>
  );
}

// --- cloze -----------------------------------------------------------------

type Segment = { kind: "text"; value: string } | { kind: "blank"; ref: string };

function Cloze({
  item,
  onAnswered,
}: {
  item: Extract<ExerciseItem, { type: "cloze" }>;
  onAnswered: (c: boolean, response?: string) => void;
}) {
  const segments = useMemo<Segment[]>(() => {
    const out: Segment[] = [];
    const re = /\{\{\s*([^}]+?)\s*\}\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(item.text)) !== null) {
      if (m.index > last)
        out.push({ kind: "text", value: item.text.slice(last, m.index) });
      out.push({ kind: "blank", ref: m[1]! });
      last = m.index + m[0].length;
    }
    if (last < item.text.length)
      out.push({ kind: "text", value: item.text.slice(last) });
    return out;
  }, [item.text]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const blankByRef = useMemo(
    () => Object.fromEntries(item.blanks.map((b) => [b.ref, b])),
    [item.blanks],
  );

  function check() {
    const allCorrect = item.blanks.every((b) =>
      gradeText(values[b.ref] ?? "", b.answer),
    );
    setDone(true);
    onAnswered(
      allCorrect,
      item.blanks.map((b) => values[b.ref] ?? "").join(" / "),
    );
  }

  return (
    <div>
      <Instructions text={item.instructions} />
      <ItemHint text={item.hint} />
      <p className="text-lg leading-loose">
        {segments.map((seg, i) => {
          if (seg.kind === "text") return <span key={i}>{seg.value}</span>;
          const blank = blankByRef[seg.ref];
          const value = values[seg.ref] ?? "";
          const ok = blank ? gradeText(value, blank.answer) : false;
          return (
            <span key={i} className="inline-flex flex-col items-start align-baseline">
              <input
                value={value}
                disabled={done}
                // A visible slot marker so the gap is recognizable even when it
                // has no cue and falls at the start of a wrapped line. Uses the
                // blank's cue when set, otherwise a neutral ellipsis.
                placeholder={blank?.cue || "…"}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [seg.ref]: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && !done && check()}
                {...answerInputProps}
                className={`mx-1 w-28 rounded border-b-2 bg-transparent px-1 text-center outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600 ${
                  !done
                    ? "border-slate-400 focus:border-accent"
                    : ok
                      ? "border-green-500 text-green-700 dark:text-green-400"
                      : "border-red-500 text-red-700 dark:text-red-400"
                }`}
              />
              {blank?.cue && !done && (
                <span className="mx-1 text-xs text-slate-400">({blank.cue})</span>
              )}
              {done && blank && !isCanonical(value, blank.answer) && (
                <span className="mx-1 text-xs text-green-600">
                  {modelAnswer(blank.answer)}
                </span>
              )}
            </span>
          );
        })}
      </p>
      {!done ? (
        <button
          type="button"
          onClick={check}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-accent-foreground"
        >
          Check
        </button>
      ) : (
        <Explanation text={item.explanation} />
      )}
    </div>
  );
}

// --- flashcard -------------------------------------------------------------

function Flashcard({
  item,
  onAnswered,
}: {
  item: Extract<ExerciseItem, { type: "flashcard" }>;
  onAnswered: (c: boolean, response?: string) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [rated, setRated] = useState(false);

  return (
    <div>
      <Instructions text={item.instructions} />
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="grid min-h-40 w-full place-items-center rounded-xl border border-slate-300 bg-white p-6 text-center text-xl dark:border-slate-700 dark:bg-slate-900"
      >
        {flipped ? item.back : item.front}
      </button>
      <p className="mt-2 text-center text-xs text-slate-400">
        {flipped ? "" : "Click to flip"}
      </p>
      {flipped && !rated && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setRated(true);
              onAnswered(false);
            }}
            className="rounded-lg border border-red-400 px-4 py-2 text-red-600"
          >
            Didn't know
          </button>
          <button
            type="button"
            onClick={() => {
              setRated(true);
              onAnswered(true);
            }}
            className="rounded-lg border border-green-400 px-4 py-2 text-green-600"
          >
            Knew it
          </button>
        </div>
      )}
      {rated && <Explanation text={item.explanation} />}
    </div>
  );
}

// --- free-text result banner ----------------------------------------------

function ResultBanner({
  result,
  answer,
  input,
  feedback,
}: {
  result: boolean;
  answer: TextAnswer;
  input: string;
  feedback?: string;
}) {
  // Show the canonical spelling on a miss, or when a lenient match differs
  // from it (e.g. missing umlaut / wrong capitalization).
  const showAnswer = !result || !isCanonical(input, answer);
  return (
    <div className="mt-3">
      <p className={`font-medium ${result ? "text-green-600" : "text-red-600"}`}>
        {result ? "Correct!" : "Not quite."}
      </p>
      {showAnswer && (
        <p className="mt-1 text-sm">
          <span className="text-slate-500">Answer: </span>
          <span className="font-medium">{modelAnswer(answer)}</span>
        </p>
      )}
      {feedback && <p className="mt-1 text-sm text-slate-500">{feedback}</p>}
    </div>
  );
}

// --- sentence build --------------------------------------------------------

function SentenceBuild({
  item,
  onAnswered,
  llmGrading,
}: {
  item: Extract<ExerciseItem, { type: "sentence_build" }>;
  onAnswered: (c: boolean, response?: string) => void;
  llmGrading?: boolean;
}) {
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ correct: boolean; feedback?: string } | null>(
    null,
  );
  const hasBank = !!item.tokens && item.tokens.length > 0;
  const remaining = (item.tokens ?? [])
    .map((_, i) => i)
    .filter((i) => !chosen.includes(i));
  const built = hasBank
    ? chosen.map((i) => item.tokens![i]).join(" ")
    : text;

  async function check() {
    setBusy(true);
    const r = await checkFreeText(built, item.answer, {
      llmGrading,
      prompt: item.instructions ?? "Build a correct German sentence.",
    });
    setBusy(false);
    setResult(r);
    onAnswered(r.correct, built);
  }

  return (
    <div>
      <Instructions
        text={item.instructions ?? "Put the words in the correct order."}
      />
      <ItemHint text={item.hint} />
      {hasBank ? (
        <>
          <div className="mb-3 min-h-12 rounded-lg border border-dashed border-slate-300 p-2 dark:border-slate-700">
            <div className="flex flex-wrap gap-2">
              {chosen.map((tokenIdx, pos) => (
                <button
                  key={pos}
                  type="button"
                  disabled={result !== null}
                  onClick={() => setChosen((c) => c.filter((_, i) => i !== pos))}
                  className="rounded bg-accent px-3 py-1 text-accent-foreground"
                >
                  {item.tokens![tokenIdx]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {remaining.map((i) => (
              <button
                key={i}
                type="button"
                disabled={result !== null}
                onClick={() => setChosen((c) => [...c, i])}
                className="rounded border border-slate-300 px-3 py-1 dark:border-slate-700"
              >
                {item.tokens![i]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <input
          value={text}
          disabled={result !== null}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && result === null && check()}
          placeholder="Type the sentence…"
          {...answerInputProps}
          className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
        />
      )}

      {result === null ? (
        <button
          type="button"
          disabled={busy || (hasBank ? chosen.length === 0 : !text.trim())}
          onClick={check}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-accent-foreground disabled:opacity-40"
        >
          {busy ? "Checking…" : "Check"}
        </button>
      ) : (
        <>
          <ResultBanner
            result={result.correct}
            answer={item.answer}
            input={built}
            feedback={result.feedback}
          />
          <Explanation text={item.explanation} />
        </>
      )}
    </div>
  );
}

// --- transform -------------------------------------------------------------

function Transform({
  item,
  onAnswered,
  llmGrading,
}: {
  item: Extract<ExerciseItem, { type: "transform" }>;
  onAnswered: (c: boolean, response?: string) => void;
  llmGrading?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ correct: boolean; feedback?: string } | null>(
    null,
  );

  async function check() {
    setBusy(true);
    const r = await checkFreeText(text, item.answer, {
      llmGrading,
      prompt: item.instructions ?? "Rewrite the sentence as required.",
    });
    setBusy(false);
    setResult(r);
    onAnswered(r.correct, text);
  }

  // A source may carry a given base sentence on the first line and a lead-in to
  // complete on the following line(s) (e.g. "Wie heißt er?\nIch habe keine
  // Ahnung, …"). Render the base as a distinct quoted block and the lead-in as
  // the prompt, so the two aren't mashed together. Single-line sources render
  // as just the quoted block, unchanged.
  const [given, ...restLines] = item.source.split("\n").map((s) => s.trim());
  const lead = restLines.filter(Boolean).join(" ");

  return (
    <div>
      <Instructions text={item.instructions} />
      <ItemHint text={item.hint} />
      <p className="mb-3 rounded-lg bg-slate-100 p-3 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        {given}
      </p>
      {lead && <p className="mb-3 text-lg leading-relaxed">{lead}</p>}
      <input
        value={text}
        disabled={result !== null}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && result === null && check()}
        placeholder="Your answer…"
        {...answerInputProps}
        className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
      />
      {result === null ? (
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={check}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-accent-foreground disabled:opacity-40"
        >
          {busy ? "Checking…" : "Check"}
        </button>
      ) : (
        <>
          <ResultBanner
            result={result.correct}
            answer={item.answer}
            input={text}
            feedback={result.feedback}
          />
          <Explanation text={item.explanation} />
        </>
      )}
    </div>
  );
}

// --- true / false ----------------------------------------------------------

function TrueFalse({
  item,
  onAnswered,
}: {
  item: Extract<ExerciseItem, { type: "true_false" }>;
  onAnswered: (c: boolean, response?: string) => void;
}) {
  const [picked, setPicked] = useState<boolean | null>(null);
  const done = picked !== null;

  function pick(value: boolean) {
    setPicked(value);
    onAnswered(value === item.correct, value ? "Correct" : "Incorrect");
  }

  return (
    <div>
      <Instructions text={item.instructions ?? "Correct or incorrect?"} />
      <ItemHint text={item.hint} />
      <p className="mb-4 text-lg">{item.statement}</p>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Correct", value: true },
          { label: "Incorrect", value: false },
        ].map((opt) => {
          const state = !done
            ? "idle"
            : opt.value === item.correct
              ? "correct"
              : opt.value === picked
                ? "wrong"
                : "idle";
          return (
            <button
              key={opt.label}
              type="button"
              disabled={done}
              onClick={() => pick(opt.value)}
              className={`rounded-lg border px-4 py-2 ${
                state === "correct"
                  ? "border-green-500 bg-green-50 dark:bg-green-950"
                  : state === "wrong"
                    ? "border-red-500 bg-red-50 dark:bg-red-950"
                    : "border-slate-300 hover:border-slate-500 dark:border-slate-700"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {done && item.correction && (
        <p className="mt-3 text-sm">
          <span className="text-slate-500">Correct form: </span>
          <span className="font-medium text-green-600">{item.correction}</span>
        </p>
      )}
      {done && <Explanation text={item.explanation} />}
    </div>
  );
}

// --- conjugation table -----------------------------------------------------

function ConjugationTable({
  item,
  onAnswered,
}: {
  item: Extract<ExerciseItem, { type: "conjugation_table" }>;
  onAnswered: (c: boolean, response?: string) => void;
}) {
  // values[colIndex][rowIndex]
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const key = (c: number, r: number) => `${c}:${r}`;

  function cellCorrect(c: number, r: number): boolean {
    const expected = item.columns[c]?.answers[r] ?? "";
    return gradeText(values[key(c, r)] ?? "", {
      accept: [expected],
      grading: "normalized",
    });
  }

  function check() {
    let all = true;
    item.columns.forEach((_, c) =>
      item.rows.forEach((_, r) => {
        if (!cellCorrect(c, r)) all = false;
      }),
    );
    setDone(true);
    onAnswered(all);
  }

  return (
    <div>
      <Instructions text={item.instructions ?? "Fill in the conjugations."} />
      <ItemHint text={item.hint} />
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="p-2" />
              {item.columns.map((col) => (
                <th key={col.header} className="p-2 text-left font-semibold">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.rows.map((row, r) => (
              <tr key={row}>
                <td className="whitespace-nowrap p-2 text-slate-500">{row}</td>
                {item.columns.map((col, c) => {
                  const value = values[key(c, r)] ?? "";
                  const ok = done && cellCorrect(c, r);
                  return (
                    <td key={col.header} className="p-1">
                      <input
                        value={value}
                        disabled={done}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [key(c, r)]: e.target.value }))
                        }
                        {...answerInputProps}
                        className={`w-24 rounded border bg-transparent px-2 py-1 outline-none ${
                          !done
                            ? "border-slate-300 focus:border-accent dark:border-slate-700"
                            : ok
                              ? "border-green-500 text-green-700 dark:text-green-400"
                              : "border-red-500 text-red-700 dark:text-red-400"
                        }`}
                      />
                      {done && !ok && (
                        <div className="text-xs text-green-600">
                          {col.answers[r]}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!done ? (
        <button
          type="button"
          onClick={check}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-accent-foreground"
        >
          Check
        </button>
      ) : (
        <Explanation text={item.explanation} />
      )}
    </div>
  );
}
