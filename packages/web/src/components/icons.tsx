import type { LucideIcon } from "lucide-react";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  Languages,
  Lightbulb,
  House,
  Layers,
  LogOut,
  NotebookPen,
  PenLine,
  Quote,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";

/**
 * The app's icon set: Lucide, drawn thin (1.75 stroke) and minimal. Use these
 * wrappers rather than lucide-react directly so the stroke stays consistent.
 */
type IconProps = { className?: string };

function wrap(Icon: LucideIcon) {
  return function AppIcon({ className = "h-4 w-4" }: IconProps) {
    return <Icon className={className} strokeWidth={1.75} aria-hidden />;
  };
}

export const HomeIcon = wrap(House);
export const PracticeIcon = wrap(PenLine);
export const SheetsIcon = wrap(FileText);
export const StoriesIcon = wrap(BookOpen);
export const VocabIcon = wrap(Layers);
export const NotesIcon = wrap(NotebookPen);
export const SettingsIcon = wrap(Settings);
export const PlayIcon = wrap(Play);
export const LogOutIcon = wrap(LogOut);
export const ChevronRightIcon = wrap(ChevronRight);
export const ChevronLeftIcon = wrap(ChevronLeft);
export const CheckIcon = wrap(Check);
export const CrossIcon = wrap(X);
export const AlertIcon = wrap(CircleAlert);
export const PlusIcon = wrap(Plus);
export const SearchIcon = wrap(Search);
export const SpeakerIcon = wrap(Volume2);
export const RetryIcon = wrap(RotateCcw);
export const SparklesIcon = wrap(Sparkles);
export const LightbulbIcon = wrap(Lightbulb);
export const LanguagesIcon = wrap(Languages);
export const QuoteIcon = wrap(Quote);
export const ArrowUpIcon = wrap(ArrowUp);
