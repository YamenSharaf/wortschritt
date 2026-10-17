import type { LucideIcon } from "lucide-react";
import {
  ArrowUp,
  BookA,
  Maximize2,
  Minimize2,
  Square,
  Type,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Headphones,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Star,
  Ellipsis,
  Download,
  FileText,
  File as FileGeneric,
  FileAudio,
  FileImage,
  Paperclip,
  Languages,
  Lightbulb,
  House,
  GraduationCap,
  Plug,
  UserRound,
  Import,
  ShieldCheck,
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
  Trash2,
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
export const PauseIcon = wrap(Pause);
export const HeadphonesIcon = wrap(Headphones);
export const SkipBackIcon = wrap(SkipBack);
export const SkipForwardIcon = wrap(SkipForward);
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
export const PenLineIcon = wrap(PenLine);
export const DownloadIcon = wrap(Download);
export const TrashIcon = wrap(Trash2);
export const GlossaryIcon = wrap(BookA);
export const MaximizeIcon = wrap(Maximize2);
export const MinimizeIcon = wrap(Minimize2);
export const StopIcon = wrap(Square);
export const TypeIcon = wrap(Type);
export const CopyIcon = wrap(Copy);
export const MoreIcon = wrap(Ellipsis);
export const ShuffleIcon = wrap(Shuffle);
export const StarIcon = wrap(Star);
export const ImportIcon = wrap(Import);
export const AdminIcon = wrap(ShieldCheck);
export const LearningIcon = wrap(GraduationCap);
export const AccountIcon = wrap(UserRound);
export const ConnectionsIcon = wrap(Plug);
export const PaperclipIcon = wrap(Paperclip);
export const FileIcon = wrap(FileGeneric);
export const FileTextIcon = wrap(FileText);
export const FileImageIcon = wrap(FileImage);
export const FileAudioIcon = wrap(FileAudio);
