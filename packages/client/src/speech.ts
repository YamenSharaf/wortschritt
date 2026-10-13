/**
 * Pronunciation and reading aloud, independent of the platform. Prefers a
 * server voice (Azure or Edge, via /api/tts) when one is chosen, otherwise the
 * device's own speech; if a server clip fails to play, it falls back too.
 * The platform supplies how to speak on the device and how to play a clip.
 */

/** The device's speech synthesis (Web Speech in the browser, expo-speech in the app). */
export type DeviceSpeech = {
  supported(): boolean;
  /** Speak `text`; resolves when it ends or fails. */
  speak(text: string, opts: { lang: string; rate: number }): Promise<void>;
  /** Stop speaking at once. */
  stop(): void;
};

/** Plays server clips (an Audio element in the browser, expo-audio in the app). */
export type ClipPlayer = {
  /** Play the clip at `url`; resolves when it ends, rejects if it can't play. */
  play(url: string, rate: number): Promise<void>;
  /** Stop the clip that's playing, if any. */
  stop(): void;
  /** Have the server make a clip ahead of time; rejects if that failed. */
  prefetch(url: string): Promise<void>;
};

/** The server voice for words (`voice`) and for reading a story aloud (`reader*`), when usable. */
export type ServerTts = { enabled: boolean; voice: string; readerEnabled: boolean; readerVoice: string };

/** Which server voices to use, from the server's TTS status and the account's settings. */
export function serverTtsFor(
  status: { available: boolean; installed: string[] },
  settings: { ttsVoice: string; readerVoice: string },
): ServerTts {
  const usable = (v: string) => status.available && !!v && status.installed.includes(v);
  const reader = settings.readerVoice === "" ? settings.ttsVoice : settings.readerVoice === "device" ? "" : settings.readerVoice;
  return { enabled: usable(settings.ttsVoice), voice: settings.ttsVoice, readerEnabled: usable(reader), readerVoice: reader };
}

/** The fields of a device voice that `pickVoice` looks at. */
export type VoiceLike = { name: string; lang: string; localService?: boolean };

/**
 * Pick the best available voice for `lang`. Prefers a high-quality voice
 * (Microsoft "Natural"/"Online" on Edge, Apple "Enhanced/Premium", or any
 * cloud voice) over the basic default, then falls back to any matching voice.
 */
export function pickVoice<V extends VoiceLike>(list: V[], lang: string): V | undefined {
  const prefix = lang.slice(0, 2).toLowerCase();
  const matching = list.filter((v) => v.lang?.toLowerCase().startsWith(prefix));
  if (matching.length === 0) return undefined;
  const nice = /natural|neural|online|enhanced|premium|wavenet/i;
  return (
    matching.find((v) => nice.test(v.name)) ??
    matching.find((v) => v.localService === false) ??
    matching[0]
  );
}

/** Split text into chunks of at most `max` characters at sentence ends
 *  (server clips cap at 500; long device utterances get cut off too). */
export function chunkText(text: string, max = 480): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]+["“”»«]*\s*|[^.!?…]+$/g) ?? [];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    // A single overlong sentence: split it hard.
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
      continue;
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

export type Speech = ReturnType<typeof createSpeech>;

export function createSpeech(o: {
  device: DeviceSpeech;
  clips: ClipPlayer;
  /** Where the server clip for `text` in `voice` is (api.ttsUrl). */
  clipUrl: (voice: string, text: string) => string;
}) {
  const { device, clips, clipUrl } = o;
  let server: ServerTts = { enabled: false, voice: "", readerEnabled: false, readerVoice: "" };
  const useServer = () => server.enabled && !!server.voice;
  const useServerForReading = () => server.readerEnabled && !!server.readerVoice;

  let sequenceToken = 0;
  /** The latest started sequence (an older one never reports onEnd). */
  let activeSequence = 0;

  // Clips already asked for in this session (the server caches them after).
  const prefetched = new Set<string>();
  function prefetch(text: string, voice: string): void {
    const url = clipUrl(voice, text);
    if (prefetched.has(url)) return;
    prefetched.add(url);
    clips.prefetch(url).catch(() => prefetched.delete(url));
  }

  /** Stop whatever is being read (a word or a whole story). */
  function stop(): void {
    sequenceToken++;
    clips.stop();
    device.stop();
  }

  return {
    /** Set by the app once it knows the server voices + chosen voice. */
    setServerTts(next: Partial<ServerTts>) {
      server = { ...server, ...next };
    },

    supported: () => useServer() || useServerForReading() || device.supported(),

    /** Say a word or a sentence. */
    speak(text: string, lang = "de-DE"): void {
      if (!text.trim()) return;
      const onDevice = () => {
        device.stop();
        void device.speak(text, { lang, rate: 0.95 });
      };
      // Server clips cap at 500 chars; long text uses the device voice.
      if (useServer() && text.length <= 500) {
        clips.stop();
        clips.play(clipUrl(server.voice, text), 1).catch(onDevice);
        return;
      }
      onDevice();
    },

    stop,

    /**
     * Read texts one after another (a story's paragraphs). `onIndex(i)` fires as
     * paragraph i starts, `onEnd` once when finished or stopped. Returns a stop
     * function. Uses the reading voice (its own setting, else the words voice)
     * when it's a server voice, the device voice otherwise.
     */
    speakSequence(
      texts: string[],
      opts: { lang?: string; rate?: number; onIndex?: (i: number) => void; onEnd?: () => void } = {},
    ): () => void {
      stop();
      const token = ++sequenceToken;
      activeSequence = token;
      const { lang = "de-DE", rate = 0.95 } = opts;
      const live = () => token === sequenceToken;
      // Every clip in order, with the paragraph it belongs to.
      const parts = texts.flatMap((t, i) => chunkText(t ?? "").map((text) => ({ i, text })));
      void (async () => {
        let current = -1;
        for (let k = 0; k < parts.length && live(); k++) {
          const { i, text } = parts[k]!;
          if (i !== current) {
            current = i;
            opts.onIndex?.(i);
          }
          if (useServerForReading()) {
            // Have the server make the next clips while this one plays, so a new
            // paragraph doesn't wait for its first synthesis.
            for (const next of parts.slice(k + 1, k + 3)) prefetch(next.text, server.readerVoice);
            try {
              await clips.play(clipUrl(server.readerVoice, text), rate);
              continue;
            } catch {
              if (!live()) break;
            }
          }
          await device.speak(text, { lang, rate });
        }
        if (live()) sequenceToken++;
        if (activeSequence === token) opts.onEnd?.();
      })();
      return stop;
    },
  };
}
