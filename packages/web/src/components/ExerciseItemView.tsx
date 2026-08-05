import { useState } from "react";
import type { ExerciseItem } from "@mdb/shared";

type Props = {
  item: ExerciseItem;
  /** Called exactly once when the learner resolves the item. */
  onAnswered: (correct: boolean) => void;
};

/**
 * One renderer per exercise *type*. Adding a new interactive type = add a case
 * here + a schema in @mdb/shared. Everything else stays data.
 */
export function ExerciseItemView({ item, onAnswered }: Props) {
  switch (item.type) {
    case "multiple_choice":
      return <MultipleChoice item={item} onAnswered={onAnswered} />;
    case "fill_in_blank":
      return <FillInBlank item={item} onAnswered={onAnswered} />;
    case "flashcard":
      return <Flashcard item={item} onAnswered={onAnswered} />;
    case "sentence_order":
      return <SentenceOrder item={item} onAnswered={onAnswered} />;
  }
}

function Explanation({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="mt-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {text}
    </p>
  );
}

function MultipleChoice({
  item,
  onAnswered,
}: {
  item: Extract<ExerciseItem, { type: "multiple_choice" }>;
  onAnswered: (c: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;

  return (
    <div>
      <p className="mb-4 text-lg">{item.prompt}</p>
      <div className="grid gap-2">
        {item.choices.map((choice, i) => {
          const isCorrect = i === item.answerIndex;
          const state = !done
            ? "idle"
            : isCorrect
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
                onAnswered(i === item.answerIndex);
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

function FillInBlank({
  item,
  onAnswered,
}: {
  item: Extract<ExerciseItem, { type: "fill_in_blank" }>;
  onAnswered: (c: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<boolean | null>(null);

  function check() {
    const accepted = [item.answer, ...item.acceptable].map((s) =>
      s.trim().toLowerCase(),
    );
    const correct = accepted.includes(value.trim().toLowerCase());
    setResult(correct);
    onAnswered(correct);
  }

  return (
    <div>
      <p className="mb-4 text-lg">{item.prompt}</p>
      <input
        value={value}
        disabled={result !== null}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && result === null && check()}
        className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
        placeholder="Type your answer…"
      />
      {result === null ? (
        <button
          type="button"
          onClick={check}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-white dark:bg-white dark:text-slate-900"
        >
          Check
        </button>
      ) : (
        <p className={`mt-3 font-medium ${result ? "text-green-600" : "text-red-600"}`}>
          {result ? "Correct!" : `Incorrect — answer: ${item.answer}`}
        </p>
      )}
      {result !== null && <Explanation text={item.explanation} />}
    </div>
  );
}

function Flashcard({
  item,
  onAnswered,
}: {
  item: Extract<ExerciseItem, { type: "flashcard" }>;
  onAnswered: (c: boolean) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [rated, setRated] = useState(false);

  return (
    <div>
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

function SentenceOrder({
  item,
  onAnswered,
}: {
  item: Extract<ExerciseItem, { type: "sentence_order" }>;
  onAnswered: (c: boolean) => void;
}) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [result, setResult] = useState<boolean | null>(null);
  const remaining = item.tokens.map((_, i) => i).filter((i) => !chosen.includes(i));

  function check() {
    const correct =
      chosen.length === item.order.length &&
      chosen.every((v, i) => v === item.order[i]);
    setResult(correct);
    onAnswered(correct);
  }

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">Put the words in the correct order:</p>
      <div className="mb-3 min-h-12 rounded-lg border border-dashed border-slate-300 p-2 dark:border-slate-700">
        <div className="flex flex-wrap gap-2">
          {chosen.map((tokenIdx, pos) => (
            <button
              key={pos}
              type="button"
              disabled={result !== null}
              onClick={() => setChosen((c) => c.filter((_, i) => i !== pos))}
              className="rounded bg-slate-900 px-3 py-1 text-white dark:bg-white dark:text-slate-900"
            >
              {item.tokens[tokenIdx]}
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
            {item.tokens[i]}
          </button>
        ))}
      </div>
      {result === null ? (
        <button
          type="button"
          disabled={chosen.length !== item.order.length}
          onClick={check}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
        >
          Check
        </button>
      ) : (
        <p className={`mt-4 font-medium ${result ? "text-green-600" : "text-red-600"}`}>
          {result
            ? "Correct!"
            : `Incorrect — answer: ${item.order.map((i) => item.tokens[i]).join(" ")}`}
        </p>
      )}
      {result !== null && <Explanation text={item.explanation} />}
    </div>
  );
}
