import { NotesIcon, PracticeIcon, SheetsIcon, StoriesIcon, VocabIcon } from "./icons";

export type Section = "practice" | "sheets" | "stories" | "vocab" | "notes";

const SECTIONS = {
  practice: { Icon: PracticeIcon, bg: "bg-section-practice" },
  sheets: { Icon: SheetsIcon, bg: "bg-section-sheets" },
  stories: { Icon: StoriesIcon, bg: "bg-section-stories" },
  vocab: { Icon: VocabIcon, bg: "bg-section-vocab" },
  notes: { Icon: NotesIcon, bg: "bg-section-notes" },
} as const;

/** The coloured squircle that identifies a section (design system: SectionIcon). */
export function SectionIcon({ section, size = "md" }: { section: Section; size?: "sm" | "md" | "lg" }) {
  const { Icon, bg } = SECTIONS[section];
  const box = size === "lg" ? "h-12 w-12 rounded-card" : size === "sm" ? "h-7 w-7 rounded-chip" : "h-9 w-9 rounded-control";
  const glyph = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]";
  return (
    <span
      className={`ws-gloss inline-grid shrink-0 place-items-center text-section-on ${box} ${bg}`}
      aria-hidden
    >
      <Icon className={glyph} />
    </span>
  );
}
