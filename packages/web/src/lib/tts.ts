/**
 * Thin wrapper over the browser's built-in speech synthesis (system TTS).
 * No network, no dependencies — the OS voice speaks the text. We hint de-DE so
 * a German voice is used when one is installed.
 */

let voices: SpeechSynthesisVoice[] = [];

function refreshVoices() {
  if (!ttsSupported()) return;
  voices = window.speechSynthesis.getVoices();
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  refreshVoices();
  // Voices load asynchronously in most browsers.
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

export function ttsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function speak(text: string, lang = "de-DE"): void {
  if (!ttsSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel(); // interrupt anything already playing
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const list = voices.length ? voices : synth.getVoices();
  const prefix = lang.slice(0, 2).toLowerCase();
  const voice = list.find((v) => v.lang?.toLowerCase().startsWith(prefix));
  if (voice) u.voice = voice;
  u.rate = 0.95;
  synth.speak(u);
}
