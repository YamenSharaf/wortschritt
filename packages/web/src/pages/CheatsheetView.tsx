import { useEffect, useRef, useState } from "react";
import Markdown from "markdown-to-jsx";
import { Link, useParams } from "react-router-dom";
import { api, askAssistant } from "../lib/api";
import { TutorMarkdown } from "../components/TutorMarkdown";
import { useAsync } from "../lib/useAsync";

const mdOptions = {
  forceBlock: true,
  overrides: {
    // Wrap tables so they scroll horizontally instead of breaking the layout.
    table: {
      component: ({ children, ...props }: { children?: React.ReactNode }) => (
        <div className="overflow-x-auto">
          <table {...props}>{children}</table>
        </div>
      ),
    },
  },
};

export function CheatsheetView() {
  const { id } = useParams();
  const sheet = useAsync(() => api.cheatsheet(id!), [id]);
  const [assistant, setAssistant] = useState(false);

  useEffect(() => {
    api
      .assistantStatus()
      .then((s) => setAssistant(s.enabled))
      .catch(() => {});
  }, []);

  return (
    <div>
      <Link to="/cheatsheets" className="text-sm text-slate-500 hover:underline">
        ← Cheat sheets
      </Link>
      {sheet.status === "loading" && <p className="mt-4 text-slate-500">Loading…</p>}
      {sheet.status === "error" && (
        <p className="mt-4 text-red-600">Not found.</p>
      )}
      {sheet.status === "ready" && (
        <article className="mt-3 space-y-6">
          <div>
            <h1 className="text-2xl font-bold">{sheet.data.title}</h1>
            {sheet.data.subtitle && (
              <p className="text-sm text-slate-500">{sheet.data.subtitle}</p>
            )}
          </div>
          {sheet.data.sections.map((sec, i) => (
            <Section
              key={i}
              heading={sec.heading}
              body={sec.body}
              canTranslate={assistant}
            />
          ))}
        </article>
      )}
    </div>
  );
}

function Section({
  heading,
  body,
  canTranslate,
}: {
  heading: string;
  body: string;
  canTranslate: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function translate() {
    if (text !== null) {
      // toggle off
      abortRef.current?.abort();
      setText(null);
      setBusy(false);
      return;
    }
    abortRef.current?.abort();
    const c = new AbortController();
    abortRef.current = c;
    setBusy(true);
    setError(null);
    setText("");
    askAssistant(
      { task: "translate_sheet", text: body },
      (t) => setText((s) => (s ?? "") + t),
      c.signal,
    )
      .catch((e) => {
        if (!c.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">{heading}</h2>
        {canTranslate && (
          <button
            type="button"
            onClick={translate}
            className="shrink-0 rounded-full border border-slate-300 px-3 py-1 text-xs hover:border-slate-500 dark:border-slate-700"
          >
            {text !== null ? "Hide" : "🌐 Translate"}
          </button>
        )}
      </div>
      <div className="md font-content text-sm">
        <Markdown options={mdOptions}>{body}</Markdown>
      </div>
      {(busy || text || error) && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
          {error ? (
            <span className="text-sm text-red-600">{error}</span>
          ) : (
            <TutorMarkdown text={text ?? ""} busy={busy} />
          )}
        </div>
      )}
    </section>
  );
}
