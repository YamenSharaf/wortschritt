/**
 * Pronunciation in the browser: the shared speech logic (@mdb/client) with
 * Web Speech as the device voice and an Audio element for server clips.
 */
import { createSpeech, pickVoice, type ClipPlayer, type DeviceSpeech } from "@mdb/client";
import { api } from "./api";

function webSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
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

const device: DeviceSpeech = {
  supported: webSpeechSupported,
  speak: (text, { lang, rate }) =>
    new Promise((resolve) => {
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
    }),
  stop: () => {
    if (webSpeechSupported()) window.speechSynthesis.cancel();
  },
};

let audio: HTMLAudioElement | null = null;
const clips: ClipPlayer = {
  play: (url, rate) =>
    new Promise((resolve, reject) => {
      const a = new Audio(url);
      audio = a;
      a.playbackRate = rate;
      a.onended = () => resolve();
      a.onerror = () => reject(new Error("clip failed"));
      a.play().catch(reject);
    }),
  stop: () => {
    audio?.pause();
    audio = null;
  },
  prefetch: (url) =>
    fetch(url, { credentials: "same-origin" })
      .then((r) => r.arrayBuffer())
      .then(() => undefined),
};

export const speech = createSpeech({ device, clips, clipUrl: api.ttsUrl });

/** Set by the app once it knows the server voices + chosen voice. */
export const setServerTts = speech.setServerTts;
export const ttsSupported = speech.supported;
export const speak = speech.speak;
/** Stop whatever is being read (a word or a whole story). */
export const stopSpeaking = speech.stop;
export const speakSequence = speech.speakSequence;
