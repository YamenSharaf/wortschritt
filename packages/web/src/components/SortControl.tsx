import { TabPills } from "./TabPills";

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

/** Compact pill toggle for the two sort modes. */
export function SortControl({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}) {
  return (
    <TabPills
      size="sm"
      label="Sort"
      value={value}
      onChange={onChange}
      options={[
        { value: "recent", label: "Recent" },
        { value: "az", label: "A–Z" },
      ]}
    />
  );
}
