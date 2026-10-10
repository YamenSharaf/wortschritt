import { Link } from "react-router-dom";
import { notices } from "@mdb/client/notices";
import { ChevronLeftIcon } from "../components/icons";

/** Open-source licences (loaded only when opened: the list is large). */
export function Licenses() {
  const packageCount = notices.groups.reduce((n, g) => n + g.packages.length, 0);
  const item = (key: string, title: string, license: string, text: string | null, note?: string) => (
    <details key={key} className="rounded-card border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer">
        <span className="font-medium">{title}</span> <span className="text-sm text-ink-subtle">· {license}</span>
      </summary>
      {note && <p className="mt-2 text-sm text-ink-muted">{note}</p>}
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink-muted">
        {text ?? "No licence file in the package; see its declared licence above."}
      </pre>
    </details>
  );
  return (
    <div className="max-w-3xl">
      <Link to="/settings" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeftIcon className="h-4 w-4" />
        Settings
      </Link>
      <h1 className="mb-2 mt-3 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">Open-source licences</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Wortschritt is MIT licensed and is built on the work of others: {notices.assets.length} bundled assets and {packageCount} packages.
      </p>
      <div className="space-y-2">
        {notices.assets.map((a, i) => item(`a${i}`, a.name, a.license, a.text, a.note))}
        {notices.groups.map((g, i) =>
          item(
            `g${i}`,
            g.packages.map((p) => `${p.name} ${p.version}`).join(", "),
            g.license,
            g.text,
          ),
        )}
      </div>
    </div>
  );
}
