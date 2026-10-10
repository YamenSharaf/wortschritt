import { Platform } from "react-native";
import * as Speech from "expo-speech";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { createSpeech, pickVoice, type ClipPlayer, type DeviceSpeech } from "@mdb/client";

/**
 * Pronunciation and reading aloud in the app: the shared speech logic
 * (@mdb/client) with the phone's voice (expo-speech) and the server's voice
 * as clips (expo-audio). Clips are kept on the device once heard (or fetched
 * ahead), so a story read once can be read again offline.
 */

// --- the device's voice ------------------------------------------------------

let voiceFor: Record<string, string | undefined> = {};
async function deviceVoice(lang: string): Promise<string | undefined> {
  if (lang in voiceFor) return voiceFor[lang];
  const list = await Speech.getAvailableVoicesAsync().catch(() => []);
  const v = pickVoice(
    list.map((x) => ({ name: x.name, lang: x.language, localService: true, id: x.identifier })),
    lang,
  );
  voiceFor = { ...voiceFor, [lang]: v?.id };
  return v?.id;
}

const device: DeviceSpeech = {
  supported: () => true,
  speak: (text, { lang, rate }) =>
    deviceVoice(lang).then(
      (voice) =>
        new Promise<void>((resolve) => {
          Speech.speak(text, { language: lang, voice, rate, onDone: resolve, onStopped: resolve, onError: () => resolve() });
        }),
    ),
  stop: () => void Speech.stop(),
};

// --- server clips, kept on the device ----------------------------------------

const MAX_CLIPS = 600;
const native = Platform.OS !== "web";
const dir = native ? new Directory(Paths.document, "tts") : null;

async function clipFile(url: string): Promise<File | null> {
  if (!dir) return null;
  // The address carries the voice and the text, so it names the clip.
  const name = await digestStringAsync(CryptoDigestAlgorithm.SHA1, url.replace(/^https?:\/\/[^/]+/, ""));
  return new File(dir, `${name}.mp3`);
}

const inFlight = new Map<string, Promise<string>>();

/** The clip's local file (downloading it the first time), or the address itself on the web. */
function localClip(url: string, headers: () => Record<string, string>): Promise<string> {
  const running = inFlight.get(url);
  if (running) return running;
  const job = (async () => {
    const file = await clipFile(url);
    if (!file || !dir) return url;
    if (file.exists && file.size > 0) return file.uri;
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const got = await File.downloadFileAsync(url, file, { headers: headers(), idempotent: true });
    if (!got.exists || !got.size) {
      if (got.exists) got.delete();
      throw new Error("empty clip");
    }
    prune();
    return got.uri;
  })().finally(() => inFlight.delete(url));
  inFlight.set(url, job);
  return job;
}

/** Keep the newest clips (a story is a few dozen). */
function prune() {
  if (!dir?.exists) return;
  const files = dir.list().filter((f): f is File => f instanceof File);
  if (files.length <= MAX_CLIPS) return;
  files
    .sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0))
    .slice(0, files.length - MAX_CLIPS)
    .forEach((f) => {
      try {
        f.delete();
      } catch {}
    });
}

/** Remove every kept clip (signing out). */
export function clearClips() {
  try {
    if (dir?.exists) dir.delete();
  } catch {}
}

function clipPlayer(headers: () => Record<string, string>): ClipPlayer {
  let player: AudioPlayer | null = null;
  let finish: (() => void) | null = null;
  const stop = () => {
    const p = player;
    player = null;
    try {
      p?.pause();
      p?.remove();
    } catch {}
    const f = finish;
    finish = null;
    f?.();
  };
  return {
    play: async (url, rate) => {
      stop();
      const uri = await localClip(url, headers);
      return new Promise<void>((resolve, reject) => {
        const p = createAudioPlayer(native ? { uri } : { uri, headers: headers() });
        player = p;
        finish = resolve;
        let loaded = false;
        const failed = setTimeout(() => {
          if (loaded || player !== p) return;
          stop();
          reject(new Error("clip didn't load"));
        }, 15000);
        p.addListener("playbackStatusUpdate", (s) => {
          if (s.isLoaded && !loaded) {
            loaded = true;
            clearTimeout(failed);
          }
          if (s.didJustFinish && player === p) {
            finish = null;
            player = null;
            p.remove();
            resolve();
          }
        });
        p.setPlaybackRate(rate);
        p.play();
      });
    },
    stop,
    prefetch: (url) => localClip(url, headers).then(() => undefined),
  };
}

/** The app's speech for one server (clips go there with the sign-in's token). */
export function appSpeech(clipUrl: (voice: string, text: string) => string, headers: () => Record<string, string>) {
  return createSpeech({ device, clips: clipPlayer(headers), clipUrl });
}
