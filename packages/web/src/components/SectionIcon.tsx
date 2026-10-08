import type { CSSProperties } from "react";
import { NotesIcon, PracticeIcon, SheetsIcon, StoriesIcon, VocabIcon } from "./icons";

export type Section = "practice" | "sheets" | "stories" | "vocab" | "notes";

const SECTIONS = {
  practice: { Icon: PracticeIcon, tint: "var(--section-practice)" },
  sheets: { Icon: SheetsIcon, tint: "var(--section-sheets)" },
  stories: { Icon: StoriesIcon, tint: "var(--section-stories)" },
  vocab: { Icon: VocabIcon, tint: "var(--section-vocab)" },
  notes: { Icon: NotesIcon, tint: "var(--section-notes)" },
} as const;

/** The tinted glass squircle that identifies a section (design system: SectionIcon). */
export function SectionIcon({ section, size = "md" }: { section: Section; size?: "sm" | "md" | "lg" }) {
  const { Icon, tint } = SECTIONS[section];
  const box = size === "lg" ? "h-12 w-12 rounded-card" : size === "sm" ? "h-7 w-7 rounded-chip" : "h-9 w-9 rounded-control";
  const glyph = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]";
  return (
    <span
      className={`ws-glass-icon inline-grid shrink-0 place-items-center ${box}`}
      style={{ "--tint": tint } as CSSProperties}
      aria-hidden
    >
      <Icon className={glyph} />
    </span>
  );
}
