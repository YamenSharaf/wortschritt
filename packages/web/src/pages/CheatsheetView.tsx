import { useEffect, useRef, useState } from "react";
import Markdown from "markdown-to-jsx";
import { Link, useParams } from "react-router-dom";
import { api, askAssistant } from "../lib/api";
import { TapToTranslate } from "../components/TapToTranslate";
import { TutorMarkdown } from "../components/TutorMarkdown";
import { useAsync } from "@mdb/client/react";
import { ChevronLeftIcon, LanguagesIcon } from "../components/icons";
import { btn } from "../components/ui";
import { StarButton } from "../components/StarButton";

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

  // Log the view so it shows up under "Recently viewed" on the dashboard.
  useEffect(() => {
    if (sheet.status !== "ready") return;
    void api.recordSheetView(sheet.data.id, sheet.data.title).catch(() => {});
  }, [sheet.status, sheet.status === "ready" ? sheet.data.id : null]);

  return (
    <div>
      <Link to="/cheatsheets" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeftIcon className="h-4 w-4" />
        Cheat sheets
      </Link>
      {sheet.status === "loading" && <p className="mt-4 text-ink-muted">Loading…</p>}
      {sheet.status === "error" && (
        <p className="mt-4 text-danger">Not found.</p>
      )}
      {sheet.status === "ready" && (
        <article className="mt-3 space-y-6">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">{sheet.data.title}</h1>
              {sheet.data.subtitle && (
                <p className="text-sm text-ink-muted">{sheet.data.subtitle}</p>
              )}
            </div>
            <StarButton kind="cheatsheet" id={sheet.data.id} title={sheet.data.title} className="mt-0.5" />
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
    <section className="rounded-card border border-line bg-surface p-4 ">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">{heading}</h2>
        {canTranslate && (
          <button
            type="button"
            onClick={translate}
            className={`${btn.secondary} ${btn.sm} shrink-0`}
          >
            {text === null && <LanguagesIcon className="h-4 w-4" />}
            {text !== null ? "Hide" : "Translate"}
          </button>
        )}
      </div>
      <TapToTranslate className="md font-content text-sm" lang="de">
        <Markdown options={mdOptions}>{body}</Markdown>
      </TapToTranslate>
      {(busy || text || error) && (
        <div className="mt-3 rounded-control border border-line bg-surface-sunken p-3 ">
          {error ? (
            <span className="text-sm text-danger">{error}</span>
          ) : (
            <TutorMarkdown text={text ?? ""} busy={busy} />
          )}
        </div>
      )}
    </section>
  );
}
