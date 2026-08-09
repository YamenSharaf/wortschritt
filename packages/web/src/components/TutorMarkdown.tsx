import Markdown from "markdown-to-jsx";
import { TapToTranslate } from "./TapToTranslate";

/** Renders streamed tutor output as Markdown (bold, inline code, short lists). */
export function TutorMarkdown({ text, busy }: { text: string; busy?: boolean }) {
  return (
    <TapToTranslate className="md font-content text-sm leading-relaxed">
      <Markdown options={{ forceBlock: true }}>{text || ""}</Markdown>
      {busy && <span className="animate-pulse">▍</span>}
    </TapToTranslate>
  );
}
