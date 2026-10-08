import { useEffect, useState } from "react";
import Markdown from "markdown-to-jsx";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  buildStoryPrompt,
  itemFormatGuide,
  slugify,
  story as storySchema,
  type CefrLevel,
  type Story,
} from "@mdb/shared";
import { api, ApiError } from "../lib/api";
import { ChevronLeftIcon, PlusIcon } from "../components/icons";
import { btn } from "../components/ui";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

type Form = {
  title: string;
  subtitle: string;
  level: CefrLevel;
  tags: string;
  body: string;
  glossary: { term: string; meaning: string }[];
  /** The questions as JSON (an array of exercise items). */
  questions: string;
};

const emptyForm = (level: CefrLevel): Form => ({
  title: "",
  subtitle: "",
  level,
  tags: "",
  body: "",
  glossary: [],
  questions: "[]",
});

const toForm = (s: Story): Form => ({
  title: s.title,
  subtitle: s.subtitle ?? "",
  level: s.level,
  tags: s.tags.join(", "),
  body: s.body,
  glossary: s.glossary,
  questions: JSON.stringify(s.questions, null, 2),
});

/** The form as a story candidate (validated separately). */
function fromForm(f: Form, id: string): unknown {
  let questions: unknown = [];
  try {
    questions = f.questions.trim() ? JSON.parse(f.questions) : [];
  } catch {
    questions = "(invalid JSON)";
  }
  return {
    id,
    title: f.title.trim(),
    ...(f.subtitle.trim() ? { subtitle: f.subtitle.trim() } : {}),
    level: f.level,
    tags: f.tags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
    body: f.body.trim(),
    glossary: f.glossary.filter((g) => g.term.trim() || g.meaning.trim()),
    questions,
  };
}

function issuesOf(candidate: unknown): string[] {
  const r = storySchema.safeParse(candidate);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".") || "(story)"}: ${i.message}`);
}

const questionsPrompt = (body: string) =>
  `Write 3–6 German comprehension questions for the story below, as a JSON array of exercise items. Answers must follow from the text; use simple German at the story's level.

${itemFormatGuide({ withIds: true })}

Output ONLY the JSON array, with no explanation and no code fences.

Story:
${body}`;

export function StoryEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState<Form | null>(editing ? null : emptyForm("A2"));
  const [mode, setMode] = useState<"form" | "json">("form");
  const [json, setJson] = useState("");
  const [preview, setPreview] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      api
        .story(id!)
        .then((v) => setForm(toForm(v.story)))
        .catch(() => setError("This story doesn't exist (or isn't yours)."));
    } else {
      api
        .settings()
        .then((s) => setForm((f) => (f && !f.title && !f.body ? { ...f, level: s.level } : f)))
        .catch(() => {});
    }
  }, [editing, id]);

  if (error && !form) return <p className="text-danger">{error}</p>;
  if (!form) return <p className="text-ink-muted">Loading…</p>;

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const currentId = editing ? id! : slugify(form.title);

  function switchMode(next: "form" | "json") {
    if (next === mode) return;
    setIssues([]);
    if (next === "json") {
      setJson(JSON.stringify(fromForm(form!, currentId), null, 2));
      setMode("json");
      return;
    }
    try {
      const parsed = storySchema.safeParse(JSON.parse(json));
      if (!parsed.success) {
        setIssues(parsed.error.issues.map((i) => `${i.path.join(".") || "(story)"}: ${i.message}`));
        return;
      }
      setForm(toForm(parsed.data));
      setMode("form");
    } catch {
      setIssues(["That isn't valid JSON."]);
    }
  }

  async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    window.setTimeout(() => setCopied(null), 2000);
  }

  async function save() {
    setError(null);
    let candidate: unknown;
    if (mode === "json") {
      try {
        candidate = JSON.parse(json);
      } catch {
        setIssues(["That isn't valid JSON."]);
        return;
      }
      if (editing && candidate && typeof candidate === "object") {
        candidate = { ...(candidate as object), id: id! };
      }
    } else {
      candidate = fromForm(form!, currentId);
    }
    const found = issuesOf(candidate);
    setIssues(found);
    if (found.length) return;
    const story = storySchema.parse(candidate);
    setBusy(true);
    try {
      if (editing) {
        await api.updateStory(story);
        navigate(`/stories/${story.id}`);
        return;
      }
      // A new story: find a free id ("…-2", "…-3") if the slug is taken.
      for (let n = 1; n <= 20; n++) {
        const tryId = n === 1 ? story.id : `${story.id.slice(0, 74)}-${n}`;
        try {
          await api.createStory({ ...story, id: tryId });
          navigate(`/stories/${tryId}`);
          return;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) throw e;
        }
      }
      setError("Couldn't find a free id for this story.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the story.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this story? Your answers to its questions stay in your history.")) return;
    await api.deleteStory(id!);
    navigate("/stories");
  }

  const tab = (active: boolean) =>
    `rounded-md px-3 py-1 text-sm ${active ? "bg-surface-raised text-ink shadow-card" : "text-ink-muted hover:text-ink"}`;
  const label = "mb-1 block text-sm font-medium";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={editing ? `/stories/${id}` : "/stories"} className="mr-auto text-sm text-ink-muted hover:underline">
          <ChevronLeftIcon className="h-4 w-4" />
          {editing ? "Back to the story" : "Stories"}
        </Link>
        <div className="inline-flex rounded-control border border-line-control p-0.5 ">
          <button type="button" className={tab(mode === "form")} onClick={() => switchMode("form")}>
            Form
          </button>
          <button type="button" className={tab(mode === "json")} onClick={() => switchMode("json")}>
            JSON
          </button>
        </div>
      </div>
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">{editing ? "Edit story" : "New story"}</h1>

      {mode === "json" ? (
        <section className="space-y-2">
          <p className="text-sm text-ink-muted">
            Paste a story in the app's format — e.g. one an AI wrote from this prompt:{" "}
            <button type="button" className="underline" onClick={() => void copy(buildStoryPrompt(), "story")}>
              {copied === "story" ? "Copied" : "Copy LLM prompt"}
            </button>
          </p>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            className="input min-h-[28rem] font-mono text-xs"
          />
        </section>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div>
              <label className={label}>Title</label>
              <input value={form.title} onChange={(e) => set({ title: e.target.value })} className="input" lang="de" />
              {!editing && form.title && (
                <p className="mt-1 text-xs text-ink-subtle">Address: /stories/{currentId}</p>
              )}
            </div>
            <div>
              <label className={label}>Level</label>
              <select value={form.level} onChange={(e) => set({ level: e.target.value as CefrLevel })} className="input">
                {LEVELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>
                Subtitle <span className="font-normal text-ink-subtle">(optional, English)</span>
              </label>
              <input value={form.subtitle} onChange={(e) => set({ subtitle: e.target.value })} className="input" />
            </div>
            <div>
              <label className={label}>
                Tags <span className="font-normal text-ink-subtle">(comma-separated)</span>
              </label>
              <input value={form.tags} onChange={(e) => set({ tags: e.target.value })} className="input" placeholder="freizeit, perfekt" />
            </div>
          </div>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium">Story (Markdown)</label>
              <div className="inline-flex rounded-control border border-line-control p-0.5 ">
                <button type="button" className={tab(!preview)} onClick={() => setPreview(false)}>
                  Write
                </button>
                <button type="button" className={tab(preview)} onClick={() => setPreview(true)}>
                  Preview
                </button>
              </div>
            </div>
            {preview ? (
              <div className="reader reader-text min-h-[20rem] rounded-card p-5 font-serif text-lg leading-relaxed" data-theme="auto">
                <Markdown options={{ forceBlock: true }}>{form.body || "*Nothing to preview yet.*"}</Markdown>
              </div>
            ) : (
              <textarea
                value={form.body}
                onChange={(e) => set({ body: e.target.value })}
                lang="de"
                placeholder={"Am Sonntag ist Lena früh aufgestanden. …\n\nLeave a blank line between paragraphs."}
                className="input min-h-[20rem] leading-relaxed"
              />
            )}
          </section>

          <section>
            <label className={label}>
              Glossary <span className="font-normal text-ink-subtle">(words worth explaining)</span>
            </label>
            <div className="space-y-2">
              {form.glossary.map((g, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={g.term}
                    placeholder="der See"
                    lang="de"
                    onChange={(e) => set({ glossary: form.glossary.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)) })}
                    className="input"
                  />
                  <input
                    value={g.meaning}
                    placeholder="the lake"
                    onChange={(e) => set({ glossary: form.glossary.map((x, j) => (j === i ? { ...x, meaning: e.target.value } : x)) })}
                    className="input"
                  />
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => set({ glossary: form.glossary.filter((_, j) => j !== i) })}
                    className="shrink-0 rounded-control border border-line-control px-3 text-ink-muted "
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => set({ glossary: [...form.glossary, { term: "", meaning: "" }] })}
                className={`${btn.secondary} ${btn.sm}`}
              >
                <PlusIcon className="h-4 w-4" />
                Add word
              </button>
            </div>
          </section>

          <details className="rounded-card border border-line p-4 " open={form.questions.trim() !== "[]"}>
            <summary className="cursor-pointer text-sm font-medium">Comprehension questions (JSON)</summary>
            <p className="mb-2 mt-2 text-sm text-ink-muted">
              An array of exercise items (the same types as exercises). Let an AI write them:{" "}
              <button
                type="button"
                className="underline"
                disabled={!form.body.trim()}
                onClick={() => void copy(questionsPrompt(form.body), "questions")}
              >
                {copied === "questions" ? "Copied" : "Copy LLM prompt for this story"}
              </button>
            </p>
            <textarea
              value={form.questions}
              onChange={(e) => set({ questions: e.target.value })}
              spellCheck={false}
              className="input min-h-[12rem] font-mono text-xs"
            />
          </details>
        </>
      )}

      {issues.length > 0 && (
        <div className="rounded-control bg-danger-soft p-3 text-sm text-danger ">
          <p className="mb-1 font-medium">Please fix:</p>
          <ul className="list-disc pl-5">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className={`${btn.primary}`}
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Save story"}
        </button>
        {editing && (
          <button type="button" onClick={() => void remove()} className="ml-auto rounded-control border border-line-control px-3 py-2 text-sm text-danger ">
            Delete story
          </button>
        )}
      </div>
    </div>
  );
}
