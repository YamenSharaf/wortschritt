import { useMemo, useState } from "react";
import {
  gradeText,
  isCanonical,
  isOpenAnswer,
  modelAnswer,
  type AnswerGrading,
  type ExerciseItem,
  type TextAnswer,
} from "@mdb/shared";
import { api } from "../lib/api";
import { CheckIcon, CrossIcon } from "./icons";
import { btn } from "./ui";

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
  onAnswered: (correct: boolean, response?: string, grading?: AnswerGrading) => void;
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
    <p className="mb-4 text-sm italic text-ink-muted">
      {text}
    </p>
  );
}

/** Always-visible helper text on an item (e.g. the words to use). */
/** A scenario/premise the item is based on — a distinct quoted block so it
 *  reads apart from the prompt/question below it. */
function Context({ text }: { text?: string }) {
  if (!text) return null;
  // The scenario the whole item hangs on. A filled block with a thick accent
  // rule on the left reads as a quoted premise — clearly apart from the thin,
  // italic task directive above and the exercise sentence below.
  return (
    <p className="mb-3 rounded-control bg-surface-sunken p-3 text-ink">
      {text}
    </p>
  );
}
function ItemHint({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="mb-3 text-sm">
      <span className="rounded-chip bg-surface-sunken px-2 py-1 text-ink-muted">
        {text}
      </span>
    </p>
  );
}

function Explanation({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="mt-3 rounded-control bg-surface-sunken p-3 text-sm text-ink-muted">
      {text}
    </p>
  );
}

/** `ungraded`: an open answer nobody could judge (no AI tutor) — no verdict,
 *  just the possible answers. */
type FreeTextResult = {
  correct: boolean;
  feedback?: string;
  ungraded?: boolean;
  grading: AnswerGrading;
};

/**
 * Grade a free-text answer: local first, then the tutor on a miss (if enabled).
 * An open-ended answer whose miss can't be judged (no tutor, or it failed)
 * comes back ungraded.
 */
async function checkFreeText(
  input: string,
  answer: TextAnswer,
  opts: { llmGrading?: boolean; prompt?: string; context?: string },
): Promise<FreeTextResult> {
  if (gradeText(input, answer)) return { correct: true, grading: "auto" };
  const open = isOpenAnswer(answer);
  if (opts.llmGrading) {
    try {
      const v = await api.gradeAnswer({
        prompt: opts.prompt,
        expected: answer.accept,
        response: input,
        context: opts.context,
        open,
      });
      return { correct: v.correct, feedback: v.feedback || undefined, grading: "ai" };
    } catch {
      /* fall back below */
    }
  }
  return open
    ? { correct: true, ungraded: true, grading: "ungraded" }
    : { correct: false, grading: "auto" };
}

/** Marks an open-ended task, so a learner knows their own wording counts. */
function OpenAnswerBadge({ answer }: { answer: TextAnswer }) {
  if (!isOpenAnswer(answer)) return null;
  return (
    <p className="mb-3 text-xs">
      <span className="rounded-full border border-line bg-surface-sunken px-2 py-0.5 font-medium text-ink-muted">
        Open answer — any correct answer counts
      </span>
    </p>
  );
}

// --- multiple choice -------------------------------------------------------

function MultipleChoice({
  item,
  onAnswered,
}: {
  item: Extract<ExerciseItem, { type: "multiple_choice" }>;
  onAnswered: Props["onAnswered"];
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;

  return (
    <div>
      <Instructions text={item.instructions} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <p className="mb-4 text-[17px] leading-7">{item.prompt}</p>
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
              className={`min-h-11 rounded-control border px-4 py-2 text-left transition-colors ${
                state === "correct"
                  ? "border-transparent bg-success-soft font-medium text-success"
                  : state === "wrong"
                    ? "border-transparent bg-danger-soft text-danger"
                    : "border-line-control bg-surface hover:border-ink-subtle hover:bg-surface-sunken disabled:opacity-60"
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
  onAnswered: Props["onAnswered"];
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
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <p className="text-lg leading-loose">
        {segments.map((seg, i) => {
          if (seg.kind === "text") return <span key={i}>{seg.value}</span>;
          const blank = blankByRef[seg.ref];
          const value = values[seg.ref] ?? "";
          const ok = blank ? gradeText(value, blank.answer) : false;
          return (
            <span key={i} className="inline-flex flex-col items-center align-baseline">
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
                className={`mx-1 h-9 w-32 rounded-[8px] border px-2.5 text-center text-base font-medium outline-none transition-colors placeholder:font-normal placeholder:text-ink-subtle ${
                  !done
                    ? "border-line-control bg-surface-sunken text-ink hover:border-ink-subtle focus:border-focus focus:bg-surface focus:shadow-[0_0_0_3px_var(--brand-soft)]"
                    : ok
                      ? "border-transparent bg-success-soft text-success"
                      : "border-transparent bg-danger-soft text-danger line-through decoration-1"
                }`}
              />
              {blank?.cue && !done && (
                <span className="mx-1 mt-0.5 text-xs text-ink-subtle">({blank.cue})</span>
              )}
              {done && blank && !isCanonical(value, blank.answer) && (
                <span className="mx-1 mt-0.5 text-xs font-semibold text-ink">
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
          className={`${btn.primary} mt-4`}
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
  onAnswered: Props["onAnswered"];
}) {
  const [flipped, setFlipped] = useState(false);
  const [rated, setRated] = useState(false);

  return (
    <div>
      <Instructions text={item.instructions} />
      <Context text={item.context} />
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="grid min-h-44 w-full place-items-center rounded-panel border border-line bg-surface p-6 text-center text-[28px] font-semibold leading-9 tracking-[-0.02em] shadow-card-hover"
      >
        {flipped ? item.back : item.front}
      </button>
      <p className="mt-2 text-center text-xs text-ink-subtle">
        {flipped ? "" : "Tap to flip"}
      </p>
      {flipped && !rated && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setRated(true);
              onAnswered(false, "Didn't know", "self");
            }}
            className={btn.secondary}
          >
            <CrossIcon className="h-4 w-4" />
            Didn't know
          </button>
          <button
            type="button"
            onClick={() => {
              setRated(true);
              onAnswered(true, "Knew it", "self");
            }}
            className={btn.primary}
          >
            <CheckIcon className="h-4 w-4" />
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
  ungraded,
}: {
  result: boolean;
  answer: TextAnswer;
  input: string;
  feedback?: string;
  ungraded?: boolean;
}) {
  const open = isOpenAnswer(answer);
  // Show the canonical spelling on a miss, or when a lenient match differs
  // from it (e.g. missing umlaut / wrong capitalization). Open answers have
  // no single canonical form: show the examples instead, whatever the result.
  const showAnswer = !open && (!result || !isCanonical(input, answer));
  return (
    <div className="mt-3">
      {!ungraded && (
        <p
          className={`flex items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold ${
            result ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
          }`}
        >
          {result ? <CheckIcon className="h-4 w-4" /> : <CrossIcon className="h-4 w-4" />}
          {result ? "Correct." : "Not quite."}
        </p>
      )}
      {open && (
        <div className="mt-2 rounded-control bg-surface-sunken p-3 text-sm">
          <p className="mb-1 text-ink-muted">Possible answers:</p>
          <ul className="space-y-1">
            {answer.accept.map((a) => (
              <li key={a} className="font-medium text-ink">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showAnswer && (
        <p className="mt-2 text-sm">
          <span className="text-ink-muted">Answer: </span>
          <span className="font-medium">{modelAnswer(answer)}</span>
        </p>
      )}
      {feedback && <p className="mt-1 text-sm text-ink-muted">{feedback}</p>}
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
  onAnswered: Props["onAnswered"];
  llmGrading?: boolean;
}) {
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FreeTextResult | null>(null);
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
    onAnswered(r.correct, built, r.grading);
  }

  return (
    <div>
      <Instructions
        text={item.instructions ?? "Put the words in the correct order."}
      />
      <OpenAnswerBadge answer={item.answer} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      {hasBank ? (
        <>
          <div className="mb-3 min-h-12 rounded-control border border-dashed border-line-control bg-surface-sunken p-2">
            <div className="flex flex-wrap gap-2">
              {chosen.map((tokenIdx, pos) => (
                <button
                  key={pos}
                  type="button"
                  disabled={result !== null}
                  onClick={() => setChosen((c) => c.filter((_, i) => i !== pos))}
                  className="rounded-[8px] border border-transparent bg-brand-soft px-3 py-1 font-medium text-brand-ink"
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
                className="rounded-[8px] border border-line-control bg-surface px-3 py-1 hover:bg-surface-sunken"
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
          className="input"
        />
      )}

      {result === null ? (
        <button
          type="button"
          disabled={busy || (hasBank ? chosen.length === 0 : !text.trim())}
          onClick={check}
          className={`${btn.primary} mt-4`}
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
            ungraded={result.ungraded}
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
  onAnswered: Props["onAnswered"];
  llmGrading?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FreeTextResult | null>(null);

  // A source may carry a given base sentence on the first line and a lead-in to
  // complete on the following line(s) (e.g. "Wie heißt er?\nIch habe keine
  // Ahnung, …"). Render the base as a distinct quoted block and the lead-in as
  // the prompt, so the two aren't mashed together. Single-line sources render
  // as just the quoted block, unchanged.
  const [given, ...restLines] = item.source.split("\n").map((s) => s.trim());
  const lead = restLines.filter(Boolean).join(" ");

  async function check() {
    setBusy(true);
    const r = await checkFreeText(text, item.answer, {
      llmGrading,
      prompt: item.instructions ?? "Rewrite the sentence as required.",
      // Tell the grader what stem the learner already sees, so a correct
      // completion-only answer (just the missing part) is accepted.
      context: [given, lead].filter(Boolean).join(" "),
    });
    setBusy(false);
    setResult(r);
    onAnswered(r.correct, text, r.grading);
  }

  return (
    <div>
      <Instructions text={item.instructions} />
      <OpenAnswerBadge answer={item.answer} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <p className="mb-3 rounded-control bg-surface-sunken p-3 text-ink">
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
        className="input"
      />
      {result === null ? (
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={check}
          className={`${btn.primary} mt-4`}
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
            ungraded={result.ungraded}
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
  onAnswered: Props["onAnswered"];
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
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <p className="mb-4 text-[17px] leading-7">{item.statement}</p>
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
              className={`min-h-11 rounded-control border px-4 py-2 transition-colors ${
                state === "correct"
                  ? "border-transparent bg-success-soft font-medium text-success"
                  : state === "wrong"
                    ? "border-transparent bg-danger-soft text-danger"
                    : "border-line-control bg-surface hover:border-ink-subtle hover:bg-surface-sunken disabled:opacity-60"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {done && item.correction && (
        <p className="mt-3 text-sm">
          <span className="text-ink-muted">Correct form: </span>
          <span className="font-semibold text-success">{item.correction}</span>
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
  onAnswered: Props["onAnswered"];
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
    // "ich: gehe / ging; du: …" — what was typed, row by row.
    const typed = item.rows
      .map((row, r) => `${row}: ${item.columns.map((_, c) => values[key(c, r)] ?? "").join(" / ")}`)
      .join("; ");
    onAnswered(all, typed);
  }

  return (
    <div>
      <Instructions text={item.instructions ?? "Fill in the conjugations."} />
      <Context text={item.context} />
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
                <td className="whitespace-nowrap p-2 text-ink-muted">{row}</td>
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
                        className={`h-9 w-28 rounded-[8px] border px-2 font-medium outline-none transition-colors ${
                          !done
                            ? "border-line-control bg-surface-sunken text-ink focus:border-focus focus:bg-surface"
                            : ok
                              ? "border-transparent bg-success-soft text-success"
                              : "border-transparent bg-danger-soft text-danger line-through decoration-1"
                        }`}
                      />
                      {done && !ok && (
                        <div className="mt-0.5 text-xs font-semibold text-ink">
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
          className={`${btn.primary} mt-4`}
        >
          Check
        </button>
      ) : (
        <Explanation text={item.explanation} />
      )}
    </div>
  );
}
