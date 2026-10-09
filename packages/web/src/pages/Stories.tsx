import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { StorySummary } from "@mdb/shared";
import { Bookshelf } from "../components/Bookshelf";
import { Cover } from "../components/Cover";
import { CheckIcon, PenLineIcon, SparklesIcon } from "../components/icons";
import { SearchBox } from "../components/SearchBox";
import { SectionIcon } from "../components/SectionIcon";
import { Muted, PageHeader, Pill, btn, cardLink } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "@mdb/client/react";


function status(s: StorySummary): { label: string; tone: "success" | "brand" } | null {
  if (s.status === "read") return { label: "Read", tone: "success" };
  if (s.status === "reading") return { label: `${Math.round(s.progress * 100)}% read`, tone: "brand" };
  return null;
}

/** The learner's own stories (private). */
export function StoriesPage() {
  const stories = useAsync(() => api.stories(), []);
  const books = useAsync(() => api.seriesList(), []);
  const [q, setQ] = useState("");
  // Chapters are reached through their book, not listed on their own.
  const list = stories.status === "ready" ? stories.data.filter((s) => !s.seriesId) : [];
  const bookList = books.status === "ready" ? books.data : [];
  const n = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!n) return list;
    return list.filter((s) =>
      [s.title, s.subtitle, s.level, ...s.tags].some((v) => (v ?? "").toLowerCase().includes(n)),
    );
  }, [list, n]);
  const filteredBooks = n
    ? bookList.filter((b) => [b.title, b.subtitle, b.description].some((v) => (v ?? "").toLowerCase().includes(n)))
    : bookList;

  return (
    <div>
      <PageHeader
        title="Stories"
        subtitle="Books and short stories at your level, with tap-to-define and read-aloud."
        actions={
          <>
            <Link to="/stories/new" className={btn.secondary}>
              <PenLineIcon className="h-4 w-4" />
              Write
            </Link>
            <Link to="/stories/generate" className={btn.primary}>
              <SparklesIcon className="h-4 w-4" />
              Generate
            </Link>
          </>
        }
      />
      {list.length + bookList.length > 3 && (
        <div className="mb-6">
          <SearchBox value={q} onChange={setQ} placeholder="Search stories…" />
        </div>
      )}
      {stories.status === "loading" && <Muted>Loading…</Muted>}
      {stories.status === "error" && <p className="text-danger">Couldn't load your stories.</p>}
      {filteredBooks.length > 0 && <Bookshelf books={filteredBooks} />}
      {filteredBooks.length > 0 && list.length > 0 && (
        <h2 className="mb-3 mt-10 text-xl font-semibold tracking-[-0.01em]">Short stories</h2>
      )}
      {stories.status === "ready" && list.length === 0 && bookList.length === 0 && (
        <div className="rounded-card border border-dashed border-line-control p-8 text-center text-ink-muted">
          <div className="mb-3 flex justify-center">
            <SectionIcon section="stories" size="lg" />
          </div>
          <p className="mb-1 font-semibold text-ink">No stories yet</p>
          <p className="text-sm">
            <Link to="/stories/generate" className="text-brand-ink underline underline-offset-2">
              Generate one
            </Link>{" "}
            from a short description, tailored to your level, your mistakes and the words you're
            learning, or{" "}
            <Link to="/stories/new" className="text-brand-ink underline underline-offset-2">
              write or paste your own
            </Link>
            . Stories are private to you.
          </p>
        </div>
      )}
      {stories.status === "ready" && filtered.length === 0 && filteredBooks.length === 0 && list.length + bookList.length > 0 && (
        <Muted>No stories match.</Muted>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {filtered.map((s) => {
          const st = status(s);
          return (
            <Link key={s.id} to={`/stories/${s.id}`} className={`${cardLink} relative flex gap-4 overflow-hidden !p-4`}>
              <Cover kind="story" id={s.id} version={s.cover} fallbackKey={`${s.title}-${s.level}`} className="w-14 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="font-semibold leading-6 tracking-[-0.005em]" lang="de">{s.title}</h3>
                {s.subtitle && <p className="text-sm text-ink-muted">{s.subtitle}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                  <Pill>{s.level}</Pill>
                  <Pill>{s.minutes} min</Pill>
                  {s.questions > 0 && <Pill>{s.questions} {s.questions === 1 ? "question" : "questions"}</Pill>}
                  {st && (
                    <Pill tone={st.tone}>
                      {st.tone === "success" && <CheckIcon className="h-3 w-3" />}
                      {st.label}
                    </Pill>
                  )}
                </div>
              </div>
              {s.status === "reading" && (
                <div className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-sunken">
                  <div className="h-full bg-brand" style={{ width: `${Math.round(s.progress * 100)}%` }} />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
