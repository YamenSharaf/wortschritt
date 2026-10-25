import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { StoryAudioBrief } from "@mdb/shared";
import { audioProgressText, retryText } from "@mdb/client";
import { plainText, storyParagraphs } from "@mdb/shared";
import { api } from "../lib/api";
import {
  chapter,
  clock,
  listen,
  listenPartial,
  openPlayer,
  pause,
  RATE_CHOICES,
  resume,
  seekBy,
  seekTo,
  setListeningRate,
  setSkip,
  SKIP_CHOICES,
  sleepIn,
  stop,
  useListening,
  type ListeningState,
  type StoryRef,
} from "../lib/listening";
import {
  AlertIcon,
  StoriesIcon,
  ChevronDownIcon,
  ClockIcon,
  CrossIcon,
  HeadphonesIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipBackSecondsIcon,
  SkipForwardIcon,
  SkipForwardSecondsIcon,
} from "./icons";
import { btn } from "./ui";

/**
 * The listening player (as the app's): a panel with the cover, the paragraph
 * being read, a scrubber, skips (a long press or right click changes how far),
 * chapters, speed, a sleep timer and "Read along"; a mini-player while
 * browsing; and a story's audio as one small control on cards and chapters.
 */

const round = "grid place-items-center rounded-full transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-35";
const play = "grid place-items-center rounded-full border border-brand bg-brand-soft text-brand-ink transition-colors hover:bg-brand-soft/80";

const toggle = (ls: ListeningState) => (ls.phase === "playing" ? pause() : resume());

/** A press that does one thing, and another on a long press (or right click). */
function useLongPress(onPress: () => void, onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: () => {
      long.current = false;
      clear();
      timer.current = setTimeout(() => {
        long.current = true;
        onLong();
      }, 500);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClick: () => {
      clear();
      if (!long.current) onPress();
      long.current = false;
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      clear();
      onLong();
    },
  };
}

function SkipButton({ dir, seconds, onLong, size = "h-14 w-14" }: { dir: "back" | "forward"; seconds: number; onLong: () => void; size?: string }) {
  const press = useLongPress(() => seekBy(dir === "back" ? -seconds : seconds), onLong);
  const Icon = dir === "back" ? SkipBackSecondsIcon : SkipForwardSecondsIcon;
  return (
    <button
      type="button"
      {...press}
      className={`${round} ${size} flex-col gap-0 select-none`}
      aria-label={`${dir === "back" ? "Back" : "Forward"} ${seconds} seconds`}
      title={`${dir === "back" ? "Back" : "Forward"} ${seconds} s · long press or right click to change`}
    >
      <Icon className="h-6 w-6" />
      <span className="text-[10px] font-medium leading-none text-ink-muted">{seconds}</span>
    </button>
  );
}

/** Choices in a row (speed, sleep, skip lengths), shown under the controls. */
function Choices<T extends string | number>({ title, value, options, onPick, onClose }: { title: string; value: T | null; options: [T, string][]; onPick: (v: T) => void; onClose: () => void }) {
  return (
    <div className="space-y-2 rounded-card border border-line bg-surface-sunken/60 p-3" role="group" aria-label={title}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <button type="button" onClick={onClose} className={`${round} h-7 w-7`} aria-label="Close">
          <CrossIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onPick(v)}
            aria-pressed={v === value}
            className={`h-8 rounded-full border px-3 text-[13px] font-medium transition-colors ${
              v === value ? "border-brand bg-brand-soft text-brand-ink" : "border-line-control bg-surface hover:bg-surface-sunken"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The player panel: a sheet on phones, a dialog on larger screens. */
export function PlayerPanel() {
  const ls = useListening();
  const [menu, setMenu] = useState<null | "speed" | "sleep" | "back" | "forward">(null);
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ls.storyId) return setParagraphs([]);
    let live = true;
    api
      .story(ls.storyId)
      .then((v) => live && setParagraphs(storyParagraphs(v.story.body).map(plainText)))
      .catch(() => live && setParagraphs([]));
    return () => {
      live = false;
    };
  }, [ls.storyId]);
  useEffect(() => {
    if (!ls.open) return setMenu(null);
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") openPlayer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ls.open]);

  if (!ls.open || !ls.storyId) return null;
  const sentence = paragraphs[ls.paragraph] ?? "";
  const long = sentence.length > 220;
  const sleepLabel = !ls.sleep ? "Sleep" : "chapterEnd" in ls.sleep ? "Sleep · end of chapter" : `Sleep · ${Math.max(1, Math.round((ls.sleep.until - Date.now()) / 60_000))} min`;
  const pill = (label: string, onClick: () => void, icon?: ReactNode) => (
    <button type="button" onClick={onClick} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-control px-3.5 text-[13px] font-medium hover:bg-surface-sunken">
      {icon}
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={() => openPlayer(false)}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Player"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-[24px] border border-line bg-bg p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-card outline-none sm:rounded-[24px] sm:pb-5"
      >
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => openPlayer(false)} className={`${round} h-10 w-10 text-ink-muted`} aria-label="Close the player">
            <ChevronDownIcon className="h-6 w-6" />
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Listening</span>
          <button type="button" onClick={stop} className={`${round} h-10 w-10 text-ink-muted`} aria-label="Stop listening" title="Stop listening">
            <CrossIcon className="h-5 w-5" />
          </button>
        </div>

        {/* A smaller cover leaves room for a long paragraph. */}
        <div className="flex justify-center">
          {ls.art ? (
            <img src={ls.art} alt="" className={`aspect-[2/3] rounded-panel bg-surface-sunken object-cover shadow-card ${long ? "w-28" : "w-44 sm:w-48"}`} />
          ) : (
            <div className={`aspect-[2/3] rounded-panel bg-surface-sunken ${long ? "w-28" : "w-44 sm:w-48"}`} />
          )}
        </div>

        <div>
          <h2 className="text-xl font-semibold leading-[26px]" lang="de">
            {ls.title}
          </h2>
          <p className="text-ink-muted">{[ls.book, ls.chapter && `Chapter ${ls.chapter.n} of ${ls.chapter.total}`].filter(Boolean).join(" · ") || "Story"}</p>
        </div>

        {ls.phase === "preparing" ? (
          <Waiting ls={ls} />
        ) : ls.phase === "error" ? (
          <p className="text-danger">Couldn't play: {ls.error}</p>
        ) : sentence ? (
          <p key={ls.paragraph} className="max-h-[35vh] overflow-y-auto rounded-control border border-line bg-surface p-3 font-content leading-relaxed" lang="de" tabIndex={0} aria-label="The paragraph being read">
            {sentence}
          </p>
        ) : null}

        {ls.partial && ls.phase !== "preparing" && (
          <p className="text-sm text-ink-muted">
            The first {ls.partial.paragraphs} of {ls.partial.of} paragraphs; the rest follows by itself once it's made.
          </p>
        )}

        <Scrubber position={ls.position} duration={ls.duration} />

        <div className="flex items-center justify-between">
          <button type="button" onClick={() => void chapter("prev")} disabled={!ls.chapter?.prev} className={`${round} h-14 w-14`} aria-label="Previous chapter" title="Previous chapter">
            <SkipBackIcon className="h-[22px] w-[22px]" />
          </button>
          <SkipButton dir="back" seconds={ls.skipBack} onLong={() => setMenu("back")} />
          <button type="button" onClick={() => toggle(ls)} className={`${play} h-[76px] w-[76px]`} aria-label={ls.phase === "playing" ? "Pause" : "Play"}>
            {ls.phase === "playing" ? <PauseIcon className="h-8 w-8" /> : <PlayIcon className="h-8 w-8" />}
          </button>
          <SkipButton dir="forward" seconds={ls.skipForward} onLong={() => setMenu("forward")} />
          <button type="button" onClick={() => void chapter("next")} disabled={!ls.chapter?.next} className={`${round} h-14 w-14`} aria-label="Next chapter" title="Next chapter">
            <SkipForwardIcon className="h-[22px] w-[22px]" />
          </button>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {pill(`${ls.rate}×`, () => setMenu(menu === "speed" ? null : "speed"))}
          {pill(sleepLabel, () => setMenu(menu === "sleep" ? null : "sleep"), <MoonIcon className="h-4 w-4" />)}
          <Link
            to={`/stories/${ls.storyId}`}
            onClick={() => openPlayer(false)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-control px-3.5 text-[13px] font-medium hover:bg-surface-sunken"
          >
            <StoriesIcon className="h-4 w-4" />
            Read along
          </Link>
        </div>

        {menu === "speed" && (
          <Choices title="Speed" value={ls.rate} options={RATE_CHOICES.map((r) => [r, `${r}×`] as [number, string])} onPick={setListeningRate} onClose={() => setMenu(null)} />
        )}
        {menu === "sleep" && (
          <Choices<string>
            title="Sleep timer"
            value={null}
            options={[["15", "15 min"], ["30", "30 min"], ["60", "60 min"], ["chapter", "End of chapter"], ["off", "Off"]]}
            onPick={(v) => {
              sleepIn(v === "off" ? null : v === "chapter" ? "chapter" : Number(v));
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
          />
        )}
        {(menu === "back" || menu === "forward") && (
          <Choices
            title={menu === "back" ? "Skip back" : "Skip forward"}
            value={menu === "back" ? ls.skipBack : ls.skipForward}
            options={SKIP_CHOICES.map((s) => [s, `${s} s`] as [number, string])}
            onPick={(s) => setSkip(menu, s)}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * While the audio is being made or waits for the voice's limit: why, and
 * (when some paragraphs are made) listening to those meanwhile, or trying
 * again now (saying so when the limit still holds).
 */
function Waiting({ ls }: { ls: ListeningState }) {
  const [tried, setTried] = useState<number | null>(null);
  const p = ls.progress;
  const waiting = p?.retryAt != null;
  const ready = p?.ready ?? 0;
  const stillLimited = waiting && tried !== null && Date.now() - tried > 1500;
  return (
    <div className="space-y-3 rounded-control border border-line bg-surface p-3">
      <p className={waiting ? "text-warning" : "text-ink-muted"}>
        {waiting ? `${p!.reason ?? "Waiting for the voice's limit"}.` : audioProgressText(p)}
      </p>
      {waiting && (
        <p className="text-sm text-ink-muted">
          {p!.done} of {p!.total} parts made · it carries on by itself {retryText(p!.retryAt!)}.
          {stillLimited ? " Tried again just now: the limit still holds." : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {ready > 0 && (
          <button type="button" className={`${btn.primary} ${btn.sm}`} onClick={() => void listenPartial()}>
            <PlayIcon className="h-4 w-4" />
            Listen to what's ready ({ready} of {p?.paragraphs} paragraphs)
          </button>
        )}
        {waiting && (
          <button
            type="button"
            className={`${btn.secondary} ${btn.sm}`}
            onClick={() => {
              setTried(Date.now());
              void listen({ id: ls.storyId!, title: ls.title, book: ls.book });
            }}
          >
            Try now
          </button>
        )}
      </div>
    </div>
  );
}

/** The time line: drag (or click, or arrow keys) to go somewhere; elapsed and remaining under it. */
function Scrubber({ position, duration }: { position: number; duration: number }) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? position;
  const frac = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;
  return (
    <div className="space-y-1">
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-sunken">
          <div className="h-full bg-brand" style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${frac * 100}%` }} />
        <input
          type="range"
          min={0}
          max={Math.max(1, duration)}
          step={1}
          value={shown}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => {
            if (drag !== null) seekTo(drag);
            setDrag(null);
          }}
          onKeyUp={() => {
            if (drag !== null) seekTo(drag);
            setDrag(null);
          }}
          aria-label="Position"
          aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <div className="flex justify-between font-mono text-xs tabular-nums text-ink-subtle">
        <span>{clock(shown)}</span>
        <span>−{clock(Math.max(0, duration - shown))}</span>
      </div>
    </div>
  );
}

/** What's playing, while browsing: skip back, play/pause; a click opens the player. */
export function MiniPlayer() {
  const ls = useListening();
  if (!ls.storyId || ls.phase === "idle") return null;
  const frac = ls.duration > 0 ? Math.min(1, ls.position / ls.duration) : 0;
  const detail =
    ls.phase === "preparing"
      ? audioProgressText(ls.progress)
      : ls.phase === "error"
        ? `Couldn't play: ${ls.error}`
        : [ls.book, `${clock(Math.max(0, ls.duration - ls.position))} left`].filter(Boolean).join(" · ");
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-30 px-3 md:bottom-4 md:left-auto md:right-4 md:w-[380px] md:px-0 print:hidden">
      <div className="ws-dock pointer-events-auto relative mx-auto flex h-16 max-w-md items-center gap-2.5 overflow-hidden !rounded-[18px] pl-2.5 pr-1.5">
        <button type="button" onClick={() => openPlayer()} className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-left" aria-label={`${ls.title}, open the player`}>
          {ls.art ? <img src={ls.art} alt="" className="h-12 w-[34px] shrink-0 rounded-[6px] object-cover" /> : <span className="h-12 w-[34px] shrink-0 rounded-[6px] bg-surface-sunken" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold" lang="de">
              {ls.title}
            </span>
            <span className={`block truncate text-xs ${ls.phase === "error" ? "text-danger" : "text-ink-muted"}`}>{detail}</span>
          </span>
        </button>
        {ls.phase !== "preparing" && (
          <>
            <button type="button" onClick={() => seekBy(-ls.skipBack)} className={`${round} h-10 w-10`} aria-label={`Back ${ls.skipBack} seconds`}>
              <SkipBackSecondsIcon className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => toggle(ls)} className={`${play} h-11 w-11 shrink-0`} aria-label={ls.phase === "playing" ? "Pause" : "Play"}>
              {ls.phase === "playing" ? <PauseIcon className="h-[18px] w-[18px]" /> : <PlayIcon className="h-[18px] w-[18px]" />}
            </button>
          </>
        )}
        <div className="absolute bottom-0 left-0 h-0.5 bg-brand" style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

/** Start (or open) a story in the player. */
export function playInPlayer(story: StoryRef, ls: ListeningState) {
  if (ls.storyId !== story.id || ls.phase === "idle") void listen(story);
  openPlayer();
}

/**
 * A story's audio, as one small control: "Generate audiobook" (asked for on
 * purpose), "Making the audio · 12 of 40", "Waiting · 34 of 80" (the voice's
 * limit), then "Play · 12 min" or "Resume · 6:12 left" (which opens the
 * player). Nothing when the reading voice isn't a server voice.
 */
export function AudioChip({ story, audio, onGenerated }: { story: StoryRef; audio: StoryAudioBrief | undefined; onGenerated: () => void }) {
  const ls = useListening();
  const [asking, setAsking] = useState(false);
  if (!ls.enabled) return null;
  const saved = ls.positions[story.id];
  const here = ls.storyId === story.id && ls.phase !== "idle";
  const generate = async () => {
    setAsking(true);
    try {
      await api.startStoryAudio(story.id);
      onGenerated();
    } catch (e) {
      window.alert(`Couldn't generate the audiobook: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAsking(false);
    }
  };

  let label: string;
  let tone = "border-transparent bg-brand-soft text-brand-ink";
  let icon = <PlayIcon className="h-3.5 w-3.5" />;
  let onClick: (() => void) | null = () => playInPlayer(story, ls);
  if (here) label = ls.phase === "playing" ? "Playing" : ls.phase === "preparing" ? "Preparing…" : "Paused";
  else if (audio?.state === "ready") {
    const left = saved && !saved.done && saved.t > 5 ? saved.duration - saved.t : null;
    label = left !== null ? `Resume · ${clock(left)} left` : `Play · ${Math.max(1, Math.round((audio.duration ?? 60) / 60))} min`;
  } else if (audio?.state === "building") {
    label = audio.total ? `Making the audio · ${audio.done} of ${audio.total}` : "Making the audio…";
    tone = "border-line-control text-ink-muted";
    icon = <ClockIcon className="h-3.5 w-3.5" />;
    onClick = null;
  } else if (audio?.state === "waiting") {
    // The player says why, and offers what's made so far and trying now.
    label = `Waiting · ${audio.done} of ${audio.total}`;
    tone = "border-transparent bg-warning-soft text-warning";
    icon = <ClockIcon className="h-3.5 w-3.5" />;
  } else if (audio?.state === "error") {
    label = "Couldn't make it · Try again";
    tone = "border-transparent bg-danger-soft text-danger";
    icon = <AlertIcon className="h-3.5 w-3.5" />;
    onClick = () => void generate();
  } else {
    label = asking ? "Asking…" : "Generate audiobook";
    tone = "border-line-control text-ink-muted hover:text-ink";
    icon = <HeadphonesIcon className="h-3.5 w-3.5" />;
    onClick = asking ? null : () => void generate();
  }
  return (
    <button
      type="button"
      // On a card that's a link: this control doesn't open the story.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.();
      }}
      disabled={!onClick}
      aria-label={`${label}: ${story.title}`}
      className={`relative z-10 inline-flex h-8 items-center gap-1.5 self-start rounded-full border px-3 text-[13px] font-medium transition-colors disabled:cursor-default ${tone}`}
    >
      {icon}
      {label}
    </button>
  );
}
