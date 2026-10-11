import { useMemo, useState } from "react";
import {
  gradeText,
  isCanonical,
  isOpenAnswer,
  modelAnswer,
  type AnswerVerdict,
  type ExerciseItem,
  type ItemResponse,
  type TextAnswer,
} from "@mdb/shared";
import { wordDiff } from "@mdb/client";
import { CheckIcon, CrossIcon, LightbulbIcon, QuoteIcon } from "./icons";
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
  /**
   * Called when the learner answers; resolves to the verdict (graded by
   * whoever the page delegates to). The view only renders it. Called once,
   * except for a translation nobody could judge: the verdict asks for the
   * learner's own check, which comes as a second call.
   */
  submit: (response: ItemResponse) => Promise<AnswerVerdict>;
};

/**
 * One renderer per exercise type. Adding a new interactive type = add a case
 * here + a schema in @mdb/shared. Everything else stays data.
 */
export function ExerciseItemView({ item, submit }: Props) {
  switch (item.type) {
    case "multiple_choice":
      return <MultipleChoice item={item} submit={submit} />;
    case "cloze":
      return <Cloze item={item} submit={submit} />;
    case "flashcard":
      return <Flashcard item={item} submit={submit} />;
    case "sentence_build":
      return <SentenceBuild item={item} submit={submit} />;
    case "transform":
      return <Transform item={item} submit={submit} />;
    case "true_false":
      return <TrueFalse item={item} submit={submit} />;
    case "conjugation_table":
      return <ConjugationTable item={item} submit={submit} />;
    case "translate":
      return <Translate item={item} submit={submit} />;
  }
}

// --- shared bits -----------------------------------------------------------

/** A small uppercase label over a helper line (design system: eyebrow). */
function Eyebrow({ children }: { children: string }) {
  return <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{children}</div>;
}

function Instructions({ text }: { text?: string }) {
  if (!text) return null;
  // The task directive: labelled and quiet, so it reads as guidance rather
  // than as part of the exercise sentence below it.
  return (
    <div className="mb-5">
      <Eyebrow>Task</Eyebrow>
      <p className="text-sm text-ink-muted">{text}</p>
    </div>
  );
}

/** A scenario/premise the item is based on: a quoted line, set apart from the
 *  prompt by a quote mark and a muted colour rather than a box. */
function Context({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="mb-5 flex gap-2.5 text-base leading-6 text-ink-muted">
      <QuoteIcon className="mt-1 h-4 w-4 shrink-0 text-ink-subtle" />
      <span>{text}</span>
    </p>
  );
}

/** Always-visible helper text on an item. A list of words ("Wörter: ich ·
 *  sich · waschen") becomes a word bank of chips; anything else a quiet line. */
function ItemHint({ text }: { text?: string }) {
  if (!text) return null;
  const m = /^([^:·]{1,20}):\s*(.+)$/.exec(text);
  const label = m ? m[1]!.trim() : "Words";
  const body = m ? m[2]! : text;
  const words = body.split("·").map((w) => w.trim()).filter(Boolean);
  if (words.length < 2) {
    return (
      <p className="mb-5 flex items-center gap-2 text-sm text-ink-muted">
        <LightbulbIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
        {text}
      </p>
    );
  }
  return (
    <div className="mb-5">
      <Eyebrow>{label}</Eyebrow>
      <div className="flex flex-wrap gap-1.5">
        {words.map((w, i) => (
          <span
            key={i}
            className="inline-flex h-7 items-center rounded-[8px] border border-dashed border-line-control px-2.5 text-sm font-medium text-ink"
          >
            {w}
          </span>
        ))}
      </div>
    </div>
  );
}

function Explanation({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <Eyebrow>Why</Eyebrow>
      <p className="text-sm leading-6 text-ink-muted">{text}</p>
    </div>
  );
}

/** Submit and keep the verdict; a failed submission is shown as an error. */
function useVerdict(submit: Props["submit"]) {
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<AnswerVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function send(r: ItemResponse) {
    setBusy(true);
    setError(null);
    try {
      setVerdict(await submit(r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check the answer.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, verdict, error, send };
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
  submit,
}: {
  item: Extract<ExerciseItem, { type: "multiple_choice" }>;
  submit: Props["submit"];
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
                void submit({ type: "multiple_choice", choice: i });
              }}
              className={`min-h-11 rounded-control border px-4 py-2 text-left transition-colors ${
                state === "correct"
                  ? "border-transparent bg-success-soft font-medium text-success"
                  : state === "wrong"
                    ? "border-transparent bg-danger-soft text-danger line-through decoration-1"
                    : "border-line-control bg-surface hover:border-ink-subtle hover:bg-surface-sunken disabled:opacity-60"
              }`}
            >
              <VerdictLabel state={state}>{choice}</VerdictLabel>
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
  submit,
}: {
  item: Extract<ExerciseItem, { type: "cloze" }>;
  submit: Props["submit"];
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
    setDone(true);
    void submit({ type: "cloze", blanks: Object.fromEntries(item.blanks.map((b) => [b.ref, values[b.ref] ?? ""])) });
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
                    ? "border-line-control bg-surface-sunken text-ink hover:border-ink-subtle focus:border-focus focus:bg-surface focus:shadow-[0_0_0_3px_var(--brand-soft),0_0_18px_var(--glow)]"
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
  submit,
}: {
  item: Extract<ExerciseItem, { type: "flashcard" }>;
  submit: Props["submit"];
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
              void submit({ type: "flashcard", knew: false });
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
              void submit({ type: "flashcard", knew: true });
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
        <div className="mt-4 text-sm">
          <Eyebrow>Possible answers</Eyebrow>
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
  submit,
}: {
  item: Extract<ExerciseItem, { type: "sentence_build" }>;
  submit: Props["submit"];
}) {
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const { busy, verdict: result, error, send } = useVerdict(submit);
  const hasBank = !!item.tokens && item.tokens.length > 0;
  const remaining = (item.tokens ?? [])
    .map((_, i) => i)
    .filter((i) => !chosen.includes(i));
  const built = hasBank
    ? chosen.map((i) => item.tokens![i]).join(" ")
    : text;

  function check() {
    void send({ type: "sentence_build", text: built });
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
      ) : null}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {result !== null && (
        <>
          <ResultBanner
            result={result.correct}
            answer={item.answer}
            input={built}
            feedback={result.feedback}
            ungraded={result.grading === "ungraded"}
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
  submit,
}: {
  item: Extract<ExerciseItem, { type: "transform" }>;
  submit: Props["submit"];
}) {
  const [text, setText] = useState("");
  const { busy, verdict: result, error, send } = useVerdict(submit);

  // A source may carry a given base sentence on the first line and a lead-in to
  // complete on the following line(s) (e.g. "Wie heißt er?\nIch habe keine
  // Ahnung, …"). Render the base as a distinct quoted block and the lead-in as
  // the prompt, so the two aren't mashed together. Single-line sources render
  // as just the quoted block, unchanged.
  const [given, ...restLines] = item.source.split("\n").map((s) => s.trim());
  const lead = restLines.filter(Boolean).join(" ");

  function check() {
    void send({ type: "transform", text });
  }

  return (
    <div>
      <Instructions text={item.instructions} />
      <OpenAnswerBadge answer={item.answer} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <p className="mb-4 text-[17px] leading-7 text-ink">{given}</p>
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
      ) : null}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {result !== null && (
        <>
          <ResultBanner
            result={result.correct}
            answer={item.answer}
            input={text}
            feedback={result.feedback}
            ungraded={result.grading === "ungraded"}
          />
          <Explanation text={item.explanation} />
        </>
      )}
    </div>
  );
}

// --- translate -------------------------------------------------------------

function Translate({
  item,
  submit,
}: {
  item: Extract<ExerciseItem, { type: "translate" }>;
  submit: Props["submit"];
}) {
  const [text, setText] = useState("");
  const { busy, verdict, error, send } = useVerdict(submit);
  const checking = verdict?.selfCheck === true;
  const done = verdict !== null && !checking;

  function check() {
    void send({ type: "translate", text });
  }

  return (
    <div>
      <Instructions text={item.instructions ?? "Translate into German."} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <Eyebrow>English</Eyebrow>
      <p className="mb-4 text-[19px] leading-8 text-ink" lang="en">
        {item.english}
      </p>
      {item.words && item.words.length > 0 && (
        <div className="mb-5">
          <Eyebrow>Words</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {item.words.map((w) => (
              <span key={w.en} className="inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-line bg-surface-sunken px-2.5 text-sm">
                <span className="text-ink-muted" lang="en">
                  {w.en}
                </span>
                <span className="text-ink-subtle">→</span>
                <span className="font-medium text-ink" lang="de">
                  {w.de}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
      <textarea
        value={text}
        disabled={verdict !== null}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (verdict === null && text.trim()) check();
          }
        }}
        rows={2}
        placeholder="Auf Deutsch…"
        {...answerInputProps}
        className="input min-h-[4.5rem] resize-none py-2.5 leading-6"
      />
      {verdict === null && (
        <button type="button" disabled={busy || !text.trim()} onClick={check} className={`${btn.primary} mt-4`}>
          {busy ? "Checking…" : "Check"}
        </button>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {checking && (
        <div className="mt-4">
          <Eyebrow>Compare with</Eyebrow>
          <ul className="mb-3 space-y-1">
            {item.answer.accept.map((a) => (
              <li key={a} className="font-medium text-ink" lang="de">
                {a}
              </li>
            ))}
          </ul>
          <p className="mb-3 text-sm text-ink-muted">Other wordings can be right too. Was yours?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void send({ type: "translate", text, selfCheck: true })} className={btn.primary}>
              I had it right
            </button>
            <button type="button" disabled={busy} onClick={() => void send({ type: "translate", text, selfCheck: false })} className={btn.secondary}>
              Not quite
            </button>
          </div>
        </div>
      )}
      {done && verdict && (
        <>
          <TranslationVerdict verdict={verdict} item={item} input={text} />
          <Explanation text={item.explanation} />
        </>
      )}
    </div>
  );
}

/** Right, almost or wrong; the learner's sentence corrected (what changed marked); another way to say it. */
function TranslationVerdict({ verdict, item, input }: { verdict: AnswerVerdict; item: Extract<ExerciseItem, { type: "translate" }>; input: string }) {
  const tone = verdict.correct ? "bg-success-soft text-success" : verdict.almost ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger";
  const label = verdict.correct ? "Correct." : verdict.almost ? "Almost." : "Not quite.";
  // The model answer is worth seeing unless the learner wrote exactly it.
  const model = modelAnswer(item.answer);
  const showModel = !isCanonical(input, item.answer);
  return (
    <div className="mt-3">
      <p className={`flex items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold ${tone}`}>
        {verdict.correct ? <CheckIcon className="h-4 w-4" /> : <CrossIcon className="h-4 w-4" />}
        {label}
      </p>
      {verdict.corrected && (
        <div className="mt-4">
          <Eyebrow>Your sentence, corrected</Eyebrow>
          <p className="text-base leading-7" lang="de">
            {wordDiff(input, verdict.corrected).map((part, i) => (
              <span key={i}>
                {part.gap ? " " : ""}
                {part.kind === "same" ? (
                  part.text
                ) : part.kind === "added" ? (
                  <span className="rounded-[4px] bg-success-soft px-0.5 font-semibold text-success">{part.text}</span>
                ) : (
                  <span className="text-danger line-through decoration-1">{part.text}</span>
                )}
              </span>
            ))}
          </p>
        </div>
      )}
      {verdict.feedback && <p className="mt-2 text-sm text-ink-muted">{verdict.feedback}</p>}
      {showModel && (
        <p className="mt-3 text-sm">
          <span className="text-ink-muted">{verdict.correct ? "Also: " : "Model answer: "}</span>
          <span className="font-medium" lang="de">
            {model}
          </span>
        </p>
      )}
    </div>
  );
}

// --- true / false ----------------------------------------------------------

function TrueFalse({
  item,
  submit,
}: {
  item: Extract<ExerciseItem, { type: "true_false" }>;
  submit: Props["submit"];
}) {
  const [picked, setPicked] = useState<boolean | null>(null);
  const done = picked !== null;

  function pick(value: boolean) {
    setPicked(value);
    void submit({ type: "true_false", value });
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
                    ? "border-transparent bg-danger-soft text-danger line-through decoration-1"
                    : "border-line-control bg-surface hover:border-ink-subtle hover:bg-surface-sunken disabled:opacity-60"
              }`}
            >
              <VerdictLabel state={state}>{opt.label}</VerdictLabel>
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
  submit,
}: {
  item: Extract<ExerciseItem, { type: "conjugation_table" }>;
  submit: Props["submit"];
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
    setDone(true);
    void submit({
      type: "conjugation_table",
      cells: item.columns.map((_, c) => item.rows.map((_, r) => values[key(c, r)] ?? "")),
    });
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

/**
 * An answer option's text with its verdict as a mark, not only a colour
 * (colour-blind learners, and e-ink, where green and red are both grey).
 */
function VerdictLabel({ state, children }: { state: "correct" | "wrong" | "idle"; children: React.ReactNode }) {
  if (state === "idle") return <>{children}</>;
  return (
    <span className="flex items-center justify-between gap-2">
      <span>{children}</span>
      {state === "correct" ? <CheckIcon className="h-4 w-4 shrink-0" /> : <CrossIcon className="h-4 w-4 shrink-0" />}
      <span className="sr-only">{state === "correct" ? "(right answer)" : "(your answer, wrong)"}</span>
    </span>
  );
}
