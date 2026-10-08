import { CrossIcon, SearchIcon } from "./icons";

/** Compact search input with a leading icon and a clear button. */
export function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-control border border-line-control bg-surface-sunken pl-9 pr-9 text-sm text-ink outline-none transition-colors placeholder:text-ink-subtle hover:border-ink-subtle focus:border-focus focus:bg-surface"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-chip text-ink-subtle hover:text-ink"
        >
          <CrossIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
