/**
 * Pronunciation. Prefers the Piper TTS sidecar (via /api/tts) when configured
 * and a voice is chosen, otherwise falls back to the browser's built-in speech
 * synthesis. If the server clip fails to play, it falls back too.
 */

type ServerTts = { enabled: boolean; voice: string };
let serverTts: ServerTts = { enabled: false, voice: "" };

/** Set by the app once it knows the sidecar status + chosen voice. */
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
