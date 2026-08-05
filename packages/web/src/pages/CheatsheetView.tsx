import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

export function CheatsheetView() {
  const { id } = useParams();
  const sheet = useAsync(() => api.cheatsheet(id!), [id]);

  return (
    <div>
      <Link to="/cheatsheets" className="text-sm text-slate-500 hover:underline">
        ← Cheat sheets
      </Link>
      {sheet.status === "loading" && <p className="mt-4 text-slate-500">Lädt…</p>}
      {sheet.status === "error" && (
        <p className="mt-4 text-red-600">Nicht gefunden.</p>
      )}
      {sheet.status === "ready" && (
        <article className="mt-3 space-y-6">
          <h1 className="text-2xl font-bold">{sheet.data.title}</h1>
          {sheet.data.sections.map((sec, i) => (
            <section key={i}>
              <h2 className="mb-2 text-lg font-semibold">{sec.heading}</h2>
              {/* Body is markdown-ish; rendered as preformatted text. Swap in a
                  markdown renderer later if you want rich formatting. */}
              <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed dark:border-slate-800 dark:bg-slate-900">
                {sec.body}
              </div>
            </section>
          ))}
        </article>
      )}
    </div>
  );
}
