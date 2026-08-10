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
function refreshVoices() {
  if (webSpeechSupported()) voices = window.speechSynthesis.getVoices();
}
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

function speakDevice(text: string, lang: string) {
  if (!webSpeechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const list = voices.length ? voices : synth.getVoices();
  const prefix = lang.slice(0, 2).toLowerCase();
  const voice = list.find((v) => v.lang?.toLowerCase().startsWith(prefix));
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
