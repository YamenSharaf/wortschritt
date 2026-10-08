/**
 * Pronunciation. Prefers a server voice (Azure or Edge, via /api/tts) when
 * one is chosen, otherwise falls back to the browser's built-in speech
 * synthesis. If the server clip fails to play, it falls back too.
 */

type ServerTts = { enabled: boolean; voice: string };
let serverTts: ServerTts = { enabled: false, voice: "" };

/** Set by the app once it knows the server voices + chosen voice. */
export function setServerTts(next: Partial<ServerTts>) {
  serverTts = { ...serverTts, ...next };
}

function webSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function ttsSupported(): boolean {
  return (serverTts.enabled && !!serverTts.voice) || webSpeechSupported();
}

let voices: SpeechSynthesisVoice[] = [];
const voiceListeners = new Set<() => void>();
function refreshVoices() {
  if (webSpeechSupported()) voices = window.speechSynthesis.getVoices();
  voiceListeners.forEach((l) => l());
}
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

/** Subscribe to the (async) device voice list becoming available/changing. */
export function onVoicesChanged(cb: () => void): () => void {
  voiceListeners.add(cb);
  return () => voiceListeners.delete(cb);
}

/** The device's available voices. */
export function deviceVoices(): SpeechSynthesisVoice[] {
  if (voices.length) return voices;
  return webSpeechSupported() ? window.speechSynthesis.getVoices() : [];
}

// A specific device voice, remembered per browser/device (not synced).
const DEVICE_VOICE_KEY = "mdb-device-voice";
export function getDeviceVoicePref(): string {
  try {
    return localStorage.getItem(DEVICE_VOICE_KEY) || "";
  } catch {
    return "";
  }
}
export function setDeviceVoicePref(uri: string): void {
  try {
    if (uri) localStorage.setItem(DEVICE_VOICE_KEY, uri);
    else localStorage.removeItem(DEVICE_VOICE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Pick the best available voice for `lang`. Prefers a high-quality voice
 * (Microsoft "Natural"/"Online" on Edge, Apple "Enhanced/Premium", or any
 * cloud voice) over the basic default, then falls back to any matching voice.
 */
function pickVoice(
  list: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | undefined {
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

function speakDevice(text: string, lang: string) {
  if (!webSpeechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const list = voices.length ? voices : synth.getVoices();
  const pref = getDeviceVoicePref();
  const voice =
    (pref && list.find((v) => v.voiceURI === pref)) || pickVoice(list, lang);
  if (voice) u.voice = voice;
  u.rate = 0.95;
  synth.speak(u);
}

let audio: HTMLAudioElement | null = null;
function speakServer(text: string, voice: string, onFail: () => void) {
  try {
    if (audio) audio.pause();
    const url = `/api/tts?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`;
    audio = new Audio(url);
    audio.onerror = onFail;
    void audio.play().catch(onFail);
  } catch {
    onFail();
  }
}

export function speak(text: string, lang = "de-DE"): void {
  if (!text.trim()) return;
  // Server clips cap at 500 chars; long text uses the device voice.
  if (serverTts.enabled && serverTts.voice && text.length <= 500) {
    speakServer(text, serverTts.voice, () => speakDevice(text, lang));
    return;
  }
  speakDevice(text, lang);
}

// --- reading aloud (stories) -------------------------------------------------

let sequenceToken = 0;
/** The latest started sequence (an older one never reports onEnd). */
let activeSequence = 0;

/** Stop whatever is being read (a word or a whole story). */
export function stopSpeaking(): void {
  sequenceToken++;
  if (audio) {
    audio.pause();
    audio = null;
  }
  if (webSpeechSupported()) window.speechSynthesis.cancel();
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

function playDevice(text: string, lang: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    if (!webSpeechSupported()) return resolve();
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const list = voices.length ? voices : synth.getVoices();
    const pref = getDeviceVoicePref();
    const voice = (pref && list.find((v) => v.voiceURI === pref)) || pickVoice(list, lang);
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}

const clipUrl = (text: string, voice: string) =>
  `/api/tts?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`;

// Clips already asked for in this page session (the server caches them after).
const prefetched = new Set<string>();
function prefetchServer(text: string, voice: string): void {
  const url = clipUrl(text, voice);
  if (prefetched.has(url)) return;
  prefetched.add(url);
  void fetch(url, { credentials: "same-origin" })
    .then((r) => r.arrayBuffer())
    .catch(() => prefetched.delete(url));
}

function playServer(text: string, voice: string, rate: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const a = new Audio(clipUrl(text, voice));
    audio = a;
    a.playbackRate = rate;
    a.onended = () => resolve();
    a.onerror = () => reject(new Error("clip failed"));
    a.play().catch(reject);
  });
}

/**
 * Read texts one after another (a story's paragraphs). `onIndex(i)` fires as
 * paragraph i starts, `onEnd` once when finished or stopped. Returns a stop
 * function. Uses the server voice when set up, the device voice otherwise.
 */
export function speakSequence(
  texts: string[],
  opts: { lang?: string; rate?: number; onIndex?: (i: number) => void; onEnd?: () => void } = {},
): () => void {
  stopSpeaking();
  const token = ++sequenceToken;
  activeSequence = token;
  const { lang = "de-DE", rate = 0.95 } = opts;
  const live = () => token === sequenceToken;
  // Every clip in order, with the paragraph it belongs to.
  const clips = texts.flatMap((t, i) => chunkText(t ?? "").map((text) => ({ i, text })));
  void (async () => {
    let current = -1;
    for (let k = 0; k < clips.length && live(); k++) {
      const { i, text } = clips[k]!;
      if (i !== current) {
        current = i;
        opts.onIndex?.(i);
      }
      if (serverTts.enabled && serverTts.voice) {
        // Have the server make the next clips while this one plays, so a new
        // paragraph doesn't wait for its first synthesis.
        for (const next of clips.slice(k + 1, k + 3)) prefetchServer(next.text, serverTts.voice);
        try {
          await playServer(text, serverTts.voice, rate);
          continue;
        } catch {
          if (!live()) break;
        }
      }
      await playDevice(text, lang, rate);
    }
    if (live()) sequenceToken++;
    if (activeSequence === token) opts.onEnd?.();
  })();
  return stopSpeaking;
}
