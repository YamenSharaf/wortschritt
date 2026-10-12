import type { FavoriteKind } from "@mdb/shared";
import { useFavorites } from "@mdb/client/react";
import { StarIcon } from "./icons";

/** Star or unstar a set or sheet (starred ones are listed first on Home). Works inside a card link. */
export function StarButton({ kind, id, title, className = "" }: { kind: FavoriteKind; id: string; title: string; className?: string }) {
  const { isFavorite, toggle } = useFavorites();
  const on = isFavorite(kind, id);
  return (
    <button
      type="button"
      onClick={(e) => {
        // Inside a card link: star it, don't open it.
        e.preventDefault();
        e.stopPropagation();
        void toggle(kind, id).catch(() => {});
      }}
      aria-pressed={on}
      aria-label={on ? `Remove ${title} from favourites` : `Add ${title} to favourites`}
      title={on ? "Remove from favourites" : "Add to favourites"}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface-sunken ${on ? "text-[#e0a800]" : "text-ink-subtle hover:text-ink"} ${className}`}
    >
      <StarIcon className={`h-[18px] w-[18px] ${on ? "fill-[var(--reward-1)]" : ""}`} />
    </button>
  );
}
