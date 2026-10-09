import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { STORY_LENGTHS, type CefrLevel } from "@mdb/shared";
import { storyProgressText, useStoryGeneration } from "@mdb/client/react";
import { ChevronLeftIcon, SparklesIcon } from "../components/icons";
import { btn } from "../components/ui";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const IDEAS = [
  "Ein Ausflug nach Hamburg mit Freunden",
  "Ein Missgeschick im Supermarkt",
  "Ein Bewerbungsgespräch, das anders läuft als geplant",
  "Ein Abend mit den Nachbarn",
];

/** "Write me a story about …" — one prompt, sensible defaults, optional context. */
export function StoryGenerate() {
  const navigate = useNavigate();
  const gen = useStoryGeneration();
  const { aiReady, prompt, setPrompt, level, setLevel, length, setLength, questions, setQuestions } = gen;
  const { vocabulary, setVocabulary, context: ctx, setContext: setCtx, preview, progress, error, busy } = gen;

  async function go() {
    const id = await gen.start();
    if (id) navigate(`/stories/${id}`);
  }

  if (aiReady === false) {
    return (
      <div className="space-y-3">
        <Link to="/stories" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
          <ChevronLeftIcon className="h-4 w-4" />
          Stories
        </Link>
        <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">Generate a story</h1>
        <p className="text-ink-muted">
          This needs your AI tutor. Set it up under{" "}
          <Link to="/settings/connections" className="underline">
            Settings → Connections
          </Link>
          , or{" "}
          <Link to="/stories/new" className="underline">
            write a story yourself
          </Link>
          .
        </p>
      </div>
    );
  }

  const segBtn = (active: boolean) =>
    `rounded-md px-3 py-1 text-sm ${active ? "bg-surface-raised text-ink shadow-card" : "text-ink-muted hover:text-ink"}`;
  const seg = "inline-flex rounded-control border border-line-control p-0.5 ";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link to="/stories" className="mr-auto text-sm text-ink-muted hover:underline">
          <ChevronLeftIcon className="h-4 w-4" />
          Stories
        </Link>
        <Link to="/stories/new" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
          Write one yourself instead
        </Link>
      </div>
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">Generate a story</h1>

      <div>
        <label htmlFor="story-prompt" className="mb-1 block text-sm font-medium">
          What should it be about?
        </label>
        <textarea
          id="story-prompt"
          autoFocus
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim().length >= 3) void go();
          }}
          placeholder="e.g. A trip to Hamburg where everything goes wrong — use lots of Perfekt. English or German is fine."
          className="input min-h-[7rem] text-base"
        />
        {!prompt && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {IDEAS.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPrompt(i)}
                className="rounded-full border border-line-control px-2.5 py-1 text-xs text-ink-muted hover:border-line-strong "
              >
                {i}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div>
          <span className="mb-1 block text-sm text-ink-muted">Level</span>
          <select value={level} disabled={busy} onChange={(e) => setLevel(e.target.value as CefrLevel)} className="input w-24">
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <span className="mb-1 block text-sm text-ink-muted">Length</span>
          <div className={seg}>
            {(["short", "medium", "long"] as const).map((l) => (
              <button key={l} type="button" disabled={busy} className={segBtn(length === l)} onClick={() => setLength(l)}>
                {l[0]!.toUpperCase() + l.slice(1)}
                <span className="ml-1 text-xs opacity-60">~{STORY_LENGTHS[l]}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-sm text-ink-muted">Questions</span>
          <select value={questions} disabled={busy} onChange={(e) => setQuestions(Number(e.target.value))} className="input w-24">
            {[0, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "None" : n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="rounded-card border border-line p-4 ">
        <h2 className="mb-2 text-sm font-semibold">Keep in mind</h2>
        <ContextOption
          label="My recent mistakes"
          hint="Uses the same grammar and words correctly in the story."
          checked={ctx.mistakes}
          disabled={busy}
          onChange={(v) => setCtx({ ...ctx, mistakes: v })}
          items={preview?.mistakes.map((m) => `${m.task} → ${m.answer}`)}
          empty="No open mistakes right now."
        />
        <ContextOption
          label="Words I'm learning"
          hint="Works your saved words in — the ones you keep missing first."
          checked={ctx.vocab}
          disabled={busy}
          onChange={(v) => setCtx({ ...ctx, vocab: v })}
          items={preview?.words}
          inline
          empty="No saved words yet."
        />
        <ContextOption
          label="What I practised recently"
          hint="Connects to your recent exercise topics if it fits."
          checked={ctx.topics}
          disabled={busy}
          onChange={(v) => setCtx({ ...ctx, topics: v })}
          items={preview?.topics}
          empty="No exercises practised yet."
        />
        <div className="mt-3 border-t border-line pt-3 ">
          <span className="mb-1.5 block text-sm">Vocabulary</span>
          <div className={seg}>
            <button type="button" disabled={busy} className={segBtn(vocabulary === "known")} onClick={() => setVocabulary("known")}>
              Mostly words I know
            </button>
            <button type="button" disabled={busy} className={segBtn(vocabulary === "stretch")} onClick={() => setVocabulary("stretch")}>
              Stretch me
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {vocabulary === "known"
              ? `Only words a ${level} learner knows.`
              : "About 1 in 20 words a bit above your level — each one explained in the glossary."}
          </p>
        </div>
      </section>

      {error && <p className="rounded-control bg-danger-soft p-3 text-sm text-danger ">{error}</p>}

      {busy ? (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4 ">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-control border-t-accent" aria-hidden />
          <span className="text-sm">{storyProgressText(progress)}</span>
          <button type="button" onClick={gen.cancel} className="ml-auto text-sm text-ink-muted underline">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={prompt.trim().length < 3 || aiReady === null}
          onClick={() => void go()}
          className={`${btn.primary}`}
        >
          <SparklesIcon className="h-4 w-4" />
          Write my story
        </button>
      )}
    </div>
  );
}

function ContextOption({
  label,
  hint,
  checked,
  disabled,
  onChange,
  items,
  inline,
  empty,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  items: string[] | undefined;
  inline?: boolean;
  empty: string;
}) {
  const [open, setOpen] = useState(false);
  const n = items?.length ?? 0;
  return (
    <div className="py-1.5">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={checked && n > 0}
          disabled={disabled || n === 0}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`text-sm ${n === 0 ? "text-ink-subtle" : ""}`}>{label}</span>
            {n > 0 && (
              <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs text-ink-muted underline">
                {open ? "hide" : `see ${n}`}
              </button>
            )}
          </div>
          <p className="text-xs text-ink-muted">{n === 0 && items ? empty : hint}</p>
          {open && n > 0 && (
            <div className="mt-1.5 rounded-control bg-surface-sunken p-2 text-xs text-ink-muted " lang="de">
              {inline ? (
                items!.join(" · ")
              ) : (
                <ul className="space-y-0.5">
                  {items!.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
