import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { DictEntry, WordDetails } from "@mdb/shared";
import { useVocabState, useWordLookup, useWordTranslation, type VocabState } from "@mdb/client/react";
import { SpeakButton } from "../components/SpeakButton";
import { perfektAux } from "@mdb/client";
import { speak, ttsSupported } from "./tts";
import { CheckIcon, CopyIcon, CrossIcon, LanguagesIcon, PlusIcon, SpeakerIcon } from "../components/icons";
import { btn } from "../components/ui";

type Anchor = {
  display: string;
  x: number;
  y: number;
  context?: string;
  view: "menu" | "panel";
};

/** The saved words (see useVocabState) and the tap-a-word popup. */
type VocabCtx = VocabState & {
  openWord: (display: string, x: number, y: number, context?: string) => void;
};

const Ctx = createContext<VocabCtx | null>(null);

export function useVocab(): VocabCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useVocab must be used within VocabProvider");
  return ctx;
}

export function VocabProvider({ children }: { children: ReactNode }) {
  const state = useVocabState();
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  function openWord(display: string, x: number, y: number, context?: string) {
    setAnchor({ display, x, y, context, view: "menu" });
  }

  const value: VocabCtx = { ...state, openWord };

  return (
    <Ctx.Provider value={value}>
      {children}
      {anchor && (
        <WordOverlay
          anchor={anchor}
          onTranslate={() => setAnchor({ ...anchor, view: "panel" })}
          onClose={() => setAnchor(null)}
        />
      )}
    </Ctx.Provider>
  );
}

// --- floating menu + translate panel ---------------------------------------

function anchorStyle(x: number, y: number): React.CSSProperties {
  const width = 300;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(8, Math.min(x - width / 2, vw - width - 8));
  const above = y > vh * 0.55;
  return above
    ? { left, bottom: vh - y + 16, width }
    : { left, top: y + 16, width };
}

const POS_LABEL: Record<string, string> = {
  verb: "verb",
  noun: "noun",
  adj: "adjective",
  adv: "adverb",
  prep: "preposition",
  conj: "conjunction",
  pron: "pronoun",
  det: "determiner",
  num: "number",
  interj: "interjection",
};

function WordOverlay({
  anchor,
  onTranslate,
  onClose,
}: {
  anchor: Anchor;
  onTranslate: () => void;
  onClose: () => void;
}) {
  const { enabled } = useVocab();
  const { dict, details } = useWordLookup(anchor.display);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute overflow-hidden rounded-card border border-line bg-surface shadow-pop "
        style={anchorStyle(anchor.x, anchor.y)}
        onClick={(e) => e.stopPropagation()}
      >
        {anchor.view === "menu" ? (
          <WordMenu
            display={anchor.display}
            dict={dict}
            details={details}
            aiEnabled={enabled}
            onTranslate={onTranslate}
            onClose={onClose}
          />
        ) : (
          <WordPanel
            display={anchor.display}
            context={anchor.context}
            dict={dict ?? null}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

/** The instant offline gloss shown at the top of the tap menu. */
function DictGloss({
  display,
  dict,
  aiEnabled,
  hasDetails,
}: {
  display: string;
  dict: DictEntry | null | undefined;
  aiEnabled: boolean;
  /** Wiktionary definitions follow below, so no "no definition" hint. */
  hasDetails: boolean;
}) {
  if (dict === undefined) {
    return (
      <div className="px-3 py-2 text-xs text-ink-subtle">Looking up…</div>
    );
  }
  if (dict === null) return null;
  const inflected = dict.lemma.toLowerCase() !== display.toLowerCase();
  const head = dict.article ? `${dict.article} ${dict.lemma}` : dict.lemma;
  return (
    <div className="border-b border-line px-3 py-2 font-content ">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">{head}</span>
        {dict.pos && (
          <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted ">
            {POS_LABEL[dict.pos] ?? dict.pos}
          </span>
        )}
        <SpeakButton text={dict.lemma} className="-my-1" />
      </div>
      {inflected && (
        <div className="text-xs text-ink-subtle">from “{display}”</div>
      )}
      {dict.gloss ? (
        <p className="mt-0.5 text-sm text-ink">
          {dict.gloss}
        </p>
      ) : hasDetails ? null : (
        <p className="mt-0.5 text-xs text-ink-subtle">
          {aiEnabled ? "Tap Translate for the meaning." : "No offline definition."}
        </p>
      )}
      {dict.pos === "noun" && dict.plural && (
        <p className="text-xs text-ink-subtle">pl. {dict.plural}</p>
      )}
      {dict.pos === "verb" && dict.partizip2 && (
        <p className="text-xs text-ink-subtle">
          Partizip II:{" "}
          <span className="font-medium text-ink-muted">
            {dict.partizip2}
          </span>
        </p>
      )}
    </div>
  );
}

const WIKI_POS: Record<string, string> = { adj: "adjective", adv: "adverb", prep: "preposition", conj: "conjunction", pron: "pronoun", det: "determiner", num: "number", intj: "interjection" };

/** Wiktionary senses under the offline gloss (credited: CC BY-SA). */
function DetailsView({ details, showHead }: { details: WordDetails | null | undefined; showHead: boolean }) {
  const [all, setAll] = useState(false);
  if (details === undefined) {
    return <div className="px-3 py-2 text-xs text-ink-subtle">Loading definitions…</div>;
  }
  if (!details) return null;
  const senses = details.entries.flatMap((e) => e.senses.map((s) => ({ ...s, pos: e.pos })));
  const shown = all ? senses : senses.slice(0, 3);
  const ipa = details.entries.find((e) => e.ipa)?.ipa;
  return (
    <div className="max-h-64 overflow-y-auto border-b border-line px-3 py-2 font-content text-sm ">
      {showHead && <div className="font-semibold">{details.word}</div>}
      {(ipa || details.formOf) && (
        <div className="mb-1 flex flex-wrap gap-x-2 text-xs text-ink-subtle">
          {ipa && <span>{ipa}</span>}
          {details.formOf && <span>{details.formOf}</span>}
        </div>
      )}
      <ol className="space-y-1.5">
        {shown.map((s, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="shrink-0 text-xs text-ink-subtle">{i + 1}.</span>
            <div className="min-w-0">
              {details.entries.length > 1 && (
                <span className="mr-1 text-[10px] uppercase tracking-wide text-ink-subtle">{WIKI_POS[s.pos] ?? s.pos}</span>
              )}
              <span className="text-ink">{s.definition}</span>
              {s.examples[0] && <p className="mt-0.5 text-xs italic text-ink-muted">{s.examples[0]}</p>}
            </div>
          </li>
        ))}
      </ol>
      {senses.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-1 text-xs text-ink-muted underline">
          {senses.length - shown.length} more
        </button>
      )}
      <p className="mt-1.5 text-[10px] text-ink-subtle">
        <a href={details.source.url} target="_blank" rel="noreferrer" className="underline">
          Wiktionary
        </a>{" "}
        ·{" "}
        <a href={details.source.licenseUrl} target="_blank" rel="noreferrer" className="underline">
          {details.source.license}
        </a>
      </p>
    </div>
  );
}

function WordMenu({
  display,
  dict,
  details,
  aiEnabled,
  onTranslate,
  onClose,
}: {
  display: string;
  dict: DictEntry | null | undefined;
  details: WordDetails | null | undefined;
  aiEnabled: boolean;
  onTranslate: () => void;
  onClose: () => void;
}) {
  const item =
    "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-sm font-medium hover:bg-surface-sunken";
  return (
    <div>
      <DictGloss display={display} dict={dict} aiEnabled={aiEnabled} hasDetails={Boolean(details)} />
      <DetailsView details={details} showHead={dict === null} />
      <div className="flex items-stretch divide-x divide-[var(--border)]">
        {ttsSupported() && (
          <button type="button" onClick={() => speak(display)} className={item}>
            <SpeakerIcon className="h-4 w-4" />
            Speak
          </button>
        )}
        {aiEnabled && (
          <button type="button" onClick={onTranslate} className={item}>
            <LanguagesIcon className="h-4 w-4" />
            Translate
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(display).catch(() => {});
            onClose();
          }}
          className={item}
        >
          <CopyIcon className="h-4 w-4" />
          Copy
        </button>
      </div>
    </div>
  );
}

function WordPanel({
  display,
  context,
  dict,
  onClose,
}: {
  display: string;
  context?: string;
  dict: DictEntry | null;
  onClose: () => void;
}) {
  const vocab = useVocab();
  const { groups } = vocab;
  const [newGroup, setNewGroup] = useState("");
  const tr = useWordTranslation({ display, context, dict, vocab });
  const { data, fetched, loading, error, headword, inflected, savedEntry, saving } = tr;
  const isSaved = !!savedEntry;

  const ex = data?.examples?.[0];
  return (
    <div className="max-h-[70vh] overflow-y-auto p-3 font-content">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-base font-semibold">
            {headword}
            {inflected && (
              <span className="ml-1.5 text-xs font-normal text-ink-subtle">
                from “{display}”
              </span>
            )}
          </span>
          <SpeakButton text={headword} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 text-ink-subtle hover:text-ink"
        >
          <CrossIcon className="h-4 w-4" />
        </button>
      </div>
      {loading && (
        <div className="py-2">
          {dict?.gloss && (
            <p className="text-sm text-ink">
              {dict.gloss}
            </p>
          )}
          <p className="text-xs text-ink-subtle">Translating…</p>
        </div>
      )}
      {error && (
        <div className="rounded-control bg-danger-soft px-2 py-1.5 text-xs text-danger">
          <p>{error}</p>
          <button
            type="button"
            onClick={tr.retry}
            className="mt-1 font-medium underline"
          >
            Try again
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="text-sm text-ink">{data.translation}</p>
          {fetched?.pos === "verb" && fetched.partizip2 && (
            <p className="mt-0.5 text-xs text-ink-subtle">
              {fetched.auxiliary
                ? `Perfekt: ${perfektAux(fetched.auxiliary)} ${fetched.partizip2}`
                : `Partizip II: ${fetched.partizip2}`}
            </p>
          )}
          {ex && (
            <div className="mt-2 rounded-lg bg-surface-sunken p-2 text-sm ">
              <div className="flex items-start justify-between gap-1">
                <p className="text-ink">{ex.de}</p>
                <SpeakButton text={ex.de} className="-mr-1 -mt-1" />
              </div>
              <p className="text-ink-muted">{ex.en}</p>
            </div>
          )}

          {groups.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-ink-subtle">
                {isSaved ? "Groups" : "Save to group"}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {groups.map((g) => {
                  const member = savedEntry?.groups.includes(g.id) ?? false;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => void tr.setGroup(g.id, !member)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        member
                          ? "border-transparent bg-brand-soft text-brand-ink"
                          : "border-line-control text-ink-muted hover:border-line-strong"
                      }`}
                    >
                      {member && <CheckIcon className="mr-0.5 inline h-3 w-3" />}
                      {g.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newGroup.trim()) return;
              await tr.addToNewGroup(newGroup);
              setNewGroup("");
            }}
            className="mt-2 flex items-center gap-1"
          >
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="New group"
              className="w-28 rounded-full border border-dashed border-line-control bg-transparent px-2.5 py-1 text-xs outline-none focus:border-focus "
            />
            {newGroup.trim() && (
              <button type="submit" className="text-xs font-medium text-accent">
                Add
              </button>
            )}
          </form>

          <div className="mt-3">
            {isSaved ? (
              <Link
                to="/vocab"
                onClick={onClose}
                className={`${btn.primary} ${btn.sm} flex-1`}
              >
                <CheckIcon className="h-4 w-4" />
                Saved · open Vocab
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void tr.add()}
                disabled={saving}
                className={`${btn.primary} ${btn.sm} w-full`}
              >
                {!saving && <PlusIcon className="h-4 w-4" />}
                {saving ? "Adding…" : "Add to vocab"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
