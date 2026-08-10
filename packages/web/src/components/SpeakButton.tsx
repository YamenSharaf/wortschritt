import { speak, ttsSupported } from "../lib/tts";

/** Speaker icon that pronounces `text` with the system TTS. Renders nothing
 *  if the browser has no speech synthesis. */
export function SpeakButton({
  text,
  lang = "de-DE",
  className = "",
}: {
  text: string;
  lang?: string;
  className?: string;
}) {
  if (!ttsSupported()) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        speak(text, lang);
      }}
      aria-label={`Pronounce ${text}`}
      title="Pronounce"
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${className}`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12" strokeLinecap="round" />
      </svg>
    </button>
  );
}
