/** In-page tabs or a view toggle as pills in a rounded track (design system: tab pills). */
export function TabPills<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="group" aria-label={label} className={`ws-tabs ${size === "sm" ? "ws-tabs--sm" : ""}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="ws-tab"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
