export type SortMode = "recent" | "az";

/** Sort content by newest-added (default) or alphabetically by title. */
export function sortByMode<T extends { title: string; createdAt?: string }>(
  items: T[],
  mode: SortMode,
): T[] {
  if (mode === "az") {
    return [...items].sort((a, b) => a.title.localeCompare(b.title, "de"));
  }
  const ts = (v?: string) => (v ? Date.parse(v) || 0 : 0);
  return [...items].sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
}

/** Compact segmented toggle for the two sort modes. */
export function SortControl({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}) {
  const opt = (mode: SortMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      aria-pressed={value === mode}
      className={`px-2.5 py-1 text-xs font-medium ${
        value === mode
          ? "bg-accent text-accent-foreground"
          : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      {opt("recent", "Recent")}
      {opt("az", "A–Z")}
    </div>
  );
}
