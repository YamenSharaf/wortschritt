import Markdown from "markdown-to-jsx";
import { TapToTranslate } from "./TapToTranslate";

/** Renders streamed tutor output as Markdown (bold, inline code, short lists). */
export function TutorMarkdown({ text, busy }: { text: string; busy?: boolean }) {
  return (
    <TapToTranslate className="md font-content text-sm leading-relaxed">
      <Markdown options={{ forceBlock: true }}>{text || ""}</Markdown>
      {busy &&
        (text ? (
          <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-brand" aria-hidden />
        ) : (
          <span className="inline-flex gap-1 py-1" aria-label="The tutor is writing">
            {[0, 150, 300].map((d) => (
              <span
                key={d}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-subtle motion-reduce:animate-none"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </span>
        ))}
    </TapToTranslate>
  );
}
