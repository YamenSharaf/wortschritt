import { useMemo, useState } from "react";
import { cheatsheet, exerciseSet, importBody } from "@mdb/shared";
import { api } from "../lib/api";

type Kind = "exercise" | "cheatsheet";

const SAMPLE_EXERCISE = {
  id: "akkusativ-basics",
  title: "Akkusativ — Grundlagen",
  description: "Übe die Akkusativ-Artikel.",
  level: "A1",
  tags: ["grammatik", "akkusativ"],
  items: [
    {
      type: "multiple_choice",
      id: "q1",
      prompt: "Ich sehe ___ Hund.",
      choices: ["der", "den", "dem"],
      answerIndex: 1,
      explanation: "Akkusativ maskulin: der → den.",
    },
    {
      type: "fill_in_blank",
      id: "q2",
      prompt: "Er kauft ___ Apfel. (ein)",
      answer: "einen",
      acceptable: [],
    },
  ],
};

export function ImportPage() {
  const [kind, setKind] = useState<Kind>("exercise");
  const [text, setText] = useState(JSON.stringify(SAMPLE_EXERCISE, null, 2));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schema = kind === "exercise" ? exerciseSet : cheatsheet;

  const localValidation = useMemo(() => {
    try {
      const parsed = JSON.parse(text);
      const r = schema.safeParse(parsed);
      return r.success
        ? { ok: true as const }
        : { ok: false as const, issues: r.error.issues };
    } catch (e) {
      return { ok: false as const, issues: [{ path: [], message: `Invalid JSON: ${String(e)}` }] };
    }
  }, [text, schema]);

  async function submit() {
    setError(null);
    setMessage(null);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      setError(`Ungültiges JSON: ${String(e)}`);
      return;
    }
    const body = importBody.safeParse({ kind, data });
    if (!body.success) {
      setError(
        body.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n"),
      );
      return;
    }
    try {
      const res = await api.import(body.data);
      setMessage(`Importiert: "${res.id}" (${res.kind})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function copyLlmPrompt() {
    const prompt = buildLlmPrompt(kind);
    void navigator.clipboard.writeText(prompt);
    setMessage("LLM-Prompt in die Zwischenablage kopiert.");
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold">Inhalt importieren</h1>
      <p className="mb-6 text-sm text-slate-500">
        Füge JSON ein (z. B. von einem LLM erzeugt). Es wird gegen das Schema
        validiert, bevor es gespeichert wird. Content und Features sind getrennt —
        hier fügst du nur Content hinzu, ohne Code zu ändern.
      </p>

      <div className="mb-4 flex items-center gap-3">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="input max-w-40"
        >
          <option value="exercise">Übung</option>
          <option value="cheatsheet">Cheat sheet</option>
        </select>
        <button
          type="button"
          onClick={copyLlmPrompt}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
        >
          LLM-Prompt kopieren
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="h-80 w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
      />

      <div className="mt-2 text-xs">
        {localValidation.ok ? (
          <span className="text-green-600">✓ Schema gültig</span>
        ) : (
          <span className="text-amber-600">
            {localValidation.issues.length} Validierungsproblem(e)
          </span>
        )}
      </div>

      <button
        type="button"
        disabled={!localValidation.ok}
        onClick={submit}
        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
      >
        Importieren
      </button>

      {message && <p className="mt-3 text-sm text-green-600">{message}</p>}
      {error && (
        <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </pre>
      )}
    </div>
  );
}

function buildLlmPrompt(kind: Kind): string {
  if (kind === "cheatsheet") {
    return `Erzeuge ein deutsches Lern-Cheatsheet als JSON in genau diesem Format:
{
  "id": "kurzer-slug",
  "title": "Titel",
  "category": "grammatik | wortschatz | ...",
  "sections": [
    { "heading": "Überschrift", "body": "Markdown-Text" }
  ]
}
Gib NUR das JSON aus, ohne Erklärung.`;
  }
  return `Erzeuge eine deutsche Übung als JSON in genau diesem Format:
{
  "id": "kurzer-slug",
  "title": "Titel",
  "description": "kurze Beschreibung",
  "level": "A1 | A2 | B1 | B2 | C1 | C2",
  "tags": ["thema"],
  "items": [
    { "type": "multiple_choice", "id": "q1", "prompt": "...", "choices": ["a","b"], "answerIndex": 0, "explanation": "optional" },
    { "type": "fill_in_blank", "id": "q2", "prompt": "... ___ ...", "answer": "wort", "acceptable": [] },
    { "type": "flashcard", "id": "q3", "front": "Vorderseite", "back": "Rückseite" },
    { "type": "sentence_order", "id": "q4", "tokens": ["Ich","bin","müde"], "order": [0,1,2] }
  ]
}
Verwende nur diese item-Typen. Gib NUR das JSON aus, ohne Erklärung.`;
}
