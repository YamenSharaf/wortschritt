import Markdown from "markdown-to-jsx";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
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
          <h1 className="text-2xl font-bold">{sheet.data.title}</h1>
          {sheet.data.sections.map((sec, i) => (
            <section
              key={i}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <h2 className="mb-2 text-lg font-semibold">{sec.heading}</h2>
              <div className="md text-sm">
                <Markdown options={mdOptions}>{sec.body}</Markdown>
              </div>
            </section>
          ))}
        </article>
      )}
    </div>
  );
}
