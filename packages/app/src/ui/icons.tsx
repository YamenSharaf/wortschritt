import {
  BookOpen,
  FileText,
  House,
  Layers,
  LogOut,
  NotebookPen,
  PenLine,
  Play,
  type LucideIcon,
} from "lucide-react-native";
import { useTheme } from "@/lib/theme";

/** Lucide at the design system's 1.75 stroke, in the ink colour unless told otherwise. */
export function Icon({ icon: I, size = 20, color }: { icon: LucideIcon; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <I size={size} strokeWidth={1.75} color={color ?? colors.ink} />;
}

/** The sections, with the web's icons and section colours. */
export const sections = {
  index: { label: "Home", icon: House, tint: null },
  practice: { label: "Practice", icon: PenLine, tint: "sectionPractice" },
  sheets: { label: "Sheets", icon: FileText, tint: "sectionSheets" },
  stories: { label: "Stories", icon: BookOpen, tint: "sectionStories" },
  vocab: { label: "Vocab", icon: Layers, tint: "sectionVocab" },
  notes: { label: "Notes", icon: NotebookPen, tint: "sectionNotes" },
} as const;

export { LogOut, Play };
