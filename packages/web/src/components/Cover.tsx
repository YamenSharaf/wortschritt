/**
 * A story's, chapter's or book's cover (its drawn art, or a cover generated
 * from the title). The URL carries the art's version, so it caches well.
 */
export function Cover({
  kind,
  id,
  version,
  fallbackKey,
  className = "",
}: {
  kind: "story" | "series";
  id: string;
  /** The cover version from the summary (null = generated cover). */
  version: string | null;
  /** Changes when a generated cover would (e.g. the title). */
  fallbackKey: string;
  className?: string;
}) {
  const v = version ?? `g-${fallbackKey}`;
  return (
    <img
      src={`/api/${kind === "series" ? "series" : "stories"}/${id}/cover.svg?v=${encodeURIComponent(v)}`}
      alt=""
      loading="lazy"
      draggable={false}
      className={`aspect-[2/3] rounded-[6px] bg-white object-cover shadow-card ring-1 ring-[var(--border)] ${className}`}
    />
  );
}
