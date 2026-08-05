import Markdown from "markdown-to-jsx";

/** Renders streamed tutor output as Markdown (bold, inline code, short lists). */
export function TutorMarkdown({ text, busy }: { text: string; busy?: boolean }) {
  return (
    <div className="md text-sm leading-relaxed">
      <Markdown options={{ forceBlock: true }}>{text || ""}</Markdown>
      {busy && <span className="animate-pulse">▍</span>}
    </div>
  );
}
