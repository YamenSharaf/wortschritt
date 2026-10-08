import { useRef, useState } from "react";
import { checkCoverSvg } from "@mdb/shared";
import { api } from "../lib/api";

/**
 * Set a story's, chapter's or book's cover from an SVG file (checked here
 * with the same rules as the server, so problems are named), or remove it.
 */
export function CoverUpload({
  kind,
  id,
  hasArt,
  onChange,
  compact = false,
}: {
  kind: "story" | "series";
  id: string;
  /** Whether it has drawn art (offers "Remove"). */
  hasArt: boolean;
  onChange: () => void;
  /** Just an icon button (for chapter rows). */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The icon button has no room for a message, so it says it in a dialog.
  function fail(message: string) {
    setError(message);
    if (compact) window.alert(message);
  }

  async function upload(file: File) {
    setError(null);
    const svg = (await file.text()).trim();
    const problems = checkCoverSvg(svg);
    if (problems.length) {
      fail(`This SVG can't be used as a cover: ${problems.slice(0, 3).join("; ")}.`);
      return;
    }
    setBusy(true);
    try {
      await api.setCover(kind, id, svg);
      onChange();
    } catch (e) {
      fail(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove this cover? A simple generated one is shown instead.")) return;
    setBusy(true);
    try {
      await api.setCover(kind, id, null);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept=".svg,image/svg+xml"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void upload(f);
      }}
    />
  );

  if (compact) {
    return (
      <>
        {picker}
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          title={error ?? "Upload a cover (SVG)"}
          aria-label="Upload a cover (SVG)"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-chip hover:bg-surface-sunken ${error ? "text-danger" : "text-ink-subtle hover:text-ink"}`}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-5-5L5 21" strokeLinejoin="round" />
          </svg>
        </button>
      </>
    );
  }
  return (
    <div className="text-sm">
      {picker}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="text-ink-muted underline underline-offset-2 hover:text-ink">
          {busy ? "Saving…" : hasArt ? "Change cover" : "Upload cover"}
        </button>
        {hasArt && (
          <button type="button" disabled={busy} onClick={() => void remove()} className="text-ink-muted underline underline-offset-2 hover:text-ink">
            Remove
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-danger">{error}</p>}
    </div>
  );
}
