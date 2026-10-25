import { serverVoices, ttsProviderOf, type TtsAdminSettings, type TtsProvider, type TtsPurpose } from "@mdb/shared";
import { guardedFetch } from "../assistant/egress";
import { decryptSecret, encryptSecret, isEncryptionAvailable } from "../assistant/secrets";
import { edgeSynthesize } from "./edge";
import { TtsRateLimited, TtsUnavailable } from "./errors";
import { geminiPcm, pcmToMp3 } from "./gemini";
import { geminiReady, listEntries, listKeys, withGemini } from "./geminiKeys";
import { backgroundSettings, edgeFallback, readSetting, setBackgroundSettings, setEdgeFallback, writeSetting } from "./settings";
import { splitPcm } from "./split";

export { TtsRateLimited, TtsUnavailable } from "./errors";

/**
 * Read-aloud providers. A voice id says which one speaks it:
 * - Azure Speech neural voices (admin stores a key + region): "azure:<name>";
 * - the Edge "Read aloud" endpoint (unofficial, admin opt-in): "edge:<name>";
 * - Gemini text-to-speech (admin stores Google AI Studio keys, tried in
 *   order: geminiKeys.ts): "gemini:<name>".
 * Settings live in app_settings; the keys are encrypted like AI keys.
 */

const AZURE_KEY = "tts.azure";
const EDGE_KEY = "tts.edge";

type AzureConfig = { region: string; key: string };

function azureConfig(): AzureConfig | null {
  const raw = readSetting(AZURE_KEY);
  if (!raw) return null;
  try {
    const { region, key } = JSON.parse(raw) as { region: string; key: string };
    const plain = decryptSecret(key);
    return plain && /^[a-z0-9]{2,30}$/.test(region) ? { region, key: plain } : null;
  } catch {
    return null;
  }
}

const edgeEnabled = () => readSetting(EDGE_KEY) === "1";

export function ttsAdminSettings(): TtsAdminSettings {
  const raw = readSetting(AZURE_KEY);
  let region = "";
  try {
    region = raw ? (JSON.parse(raw) as { region: string }).region : "";
  } catch {
    /* keep empty */
  }
  return {
    azure: { configured: azureConfig() !== null, region, canStoreKey: isEncryptionAvailable },
    edge: { enabled: edgeEnabled() },
    gemini: { keys: listKeys(), entries: listEntries() },
    background: backgroundSettings(),
    edgeFallback: edgeFallback(),
  };
}

export class TtsConfigError extends Error {}

/** Change the cloud providers (Azure: key optional = keep the stored one; null = remove). */
export function updateTtsSettings(body: {
  azure?: { region: string; key?: string } | null;
  edge?: boolean;
  background?: { enabled: boolean; reserve: number };
  edgeFallback?: boolean;
}): void {
  if (body.azure === null) writeSetting(AZURE_KEY, null);
  else if (body.azure) {
    let stored: string | null = null;
    if (body.azure.key) {
      if (!isEncryptionAvailable) throw new TtsConfigError("set ENCRYPTION_KEY on the server to store keys");
      stored = encryptSecret(body.azure.key);
    } else {
      const raw = readSetting(AZURE_KEY);
      stored = raw ? ((JSON.parse(raw) as { key?: string }).key ?? null) : null;
      if (!stored) throw new TtsConfigError("enter the Azure Speech key");
    }
    writeSetting(AZURE_KEY, JSON.stringify({ region: body.azure.region, key: stored }));
  }
  if (body.edge !== undefined) writeSetting(EDGE_KEY, body.edge ? "1" : null);
  if (body.background) setBackgroundSettings(body.background);
  if (body.edgeFallback !== undefined) setEdgeFallback(body.edgeFallback);
}

export type VoiceOption = { id: string; label: string; provider: TtsProvider };

/** Every voice usable right now. */
export function usableVoices(): VoiceOption[] {
  const out: VoiceOption[] = [];
  if (azureConfig()) for (const v of serverVoices("azure")) out.push({ id: `azure:${v.name}`, label: `${v.label} · Azure`, provider: "azure" });
  if (edgeEnabled()) for (const v of serverVoices("edge")) out.push({ id: `edge:${v.name}`, label: `${v.label} · Edge`, provider: "edge" });
  if (geminiReady()) for (const v of serverVoices("gemini")) out.push({ id: `gemini:${v.name}`, label: `${v.label} · Gemini`, provider: "gemini" });
  return out;
}

/**
 * The voices to offer: usableVoices, less Azure HD voices the region doesn't
 * have (HD voices are in some regions only). If Azure can't be asked, all of them.
 */
export async function offeredVoices(): Promise<VoiceOption[]> {
  const voices = usableVoices();
  const cfg = azureConfig();
  if (!cfg || !voices.some((v) => v.id.includes("DragonHD"))) return voices;
  const inRegion = await regionVoices(cfg).catch(() => null);
  if (!inRegion) return voices;
  return voices.filter((v) => !(v.provider === "azure" && v.id.includes("DragonHD")) || inRegion.has(v.id.slice("azure:".length)));
}

const VOICE_NAMES = {
  azure: new Set(serverVoices("azure").map((v) => v.name)),
  edge: new Set(serverVoices("edge").map((v) => v.name)),
  gemini: new Set(serverVoices("gemini").map((v) => v.name)),
};
const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// The voices an Azure region offers (its voices/list), kept for an hour.
let regionList: { region: string; at: number; names: Set<string> } | null = null;
async function regionVoices(cfg: AzureConfig): Promise<Set<string>> {
  if (regionList && regionList.region === cfg.region && Date.now() - regionList.at < 3_600_000) return regionList.names;
  const res = await guardedFetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { "Ocp-Apim-Subscription-Key": cfg.key, "User-Agent": "wortschritt" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`voices/list ${res.status}`);
  const list = (await res.json()) as { ShortName?: string }[];
  regionList = { region: cfg.region, at: Date.now(), names: new Set(list.map((v) => v.ShortName ?? "")) };
  return regionList.names;
}

/**
 * Whether a voice is better asked for several paragraphs at once (its limit
 * counts requests, not length): Gemini's.
 */
export const groupsParagraphs = (voice: string) => ttsProviderOf(voice) === "gemini";

/**
 * Several paragraphs in one request, cut back into one MP3 each (in the
 * pauses between them, see split.ts). Only for voices that group paragraphs.
 */
export async function synthesizeGroup(texts: string[], voice: string, purpose: TtsPurpose): Promise<Buffer[]> {
  const name = voice.slice("gemini:".length);
  if (!groupsParagraphs(voice) || !VOICE_NAMES.gemini.has(name)) throw new TtsUnavailable(`unknown voice "${voice}"`);
  return withGemini(purpose, async (cfg) => {
    const pcm = await geminiPcm(texts.join("\n\n"), name, cfg);
    return { result: splitPcm(pcm, texts.map((t) => t.length)).map(pcmToMp3), seconds: pcm.length / 48_000 };
  });
}

/** Edge's voice for taps when every Gemini entry is used up. */
const FALLBACK_VOICE = "de-DE-KatjaNeural";

/**
 * Synthesize with whichever provider the voice belongs to, for `purpose`
 * (which Gemini entries may be used). `fallback`: read by another voice
 * (Edge, for a tap when Gemini is used up), so not to be kept as this one's.
 */
export async function synthesize(
  text: string,
  voice: string,
  purpose: TtsPurpose = "taps",
): Promise<{ audio: Buffer; type: string; ext: string; fallback?: boolean }> {
  const provider = ttsProviderOf(voice);
  if (!provider) throw new TtsUnavailable(`unknown voice "${voice}"`);
  const name = voice.slice(provider.length + 1);
  if (!VOICE_NAMES[provider].has(name)) throw new TtsUnavailable(`unknown voice "${voice}"`);
  if (provider === "edge") {
    if (!edgeEnabled()) throw new TtsUnavailable("Edge voices are turned off");
    return { audio: await edgeSynthesize(text, name), type: "audio/mpeg", ext: "mp3" };
  }
  if (provider === "gemini") {
    if (!geminiReady()) throw new TtsUnavailable("Gemini isn't set up");
    try {
      const audio = await withGemini(purpose, async (cfg) => {
        const pcm = await geminiPcm(text, name, cfg);
        return { result: pcmToMp3(pcm), seconds: pcm.length / 48_000 };
      });
      return { audio, type: "audio/mpeg", ext: "mp3" };
    } catch (err) {
      if (err instanceof TtsRateLimited && purpose === "taps" && edgeFallback()) {
        return { audio: await edgeSynthesize(text, FALLBACK_VOICE), type: "audio/mpeg", ext: "mp3", fallback: true };
      }
      throw err;
    }
  }
  const cfg = azureConfig();
  if (!cfg) throw new TtsUnavailable("Azure Speech isn't set up");
  const lang = name.split("-").slice(0, 2).join("-"); // "de-DE" (HD names have ":DragonHD…" after the speaker)
  const res = await guardedFetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": cfg.key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "wortschritt",
    },
    body: `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${name}'>${xmlEscape(text)}</voice></speak>`,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) {
    // The free tier's limit (Azure says when to try again).
    const after = Number(res.headers.get("retry-after"));
    throw new TtsRateLimited("Azure Speech's limit is used up for now; try again later", Number.isFinite(after) && after > 0 ? after : null);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    // Azure says nothing on a 400; a voice the region doesn't offer is the usual reason.
    if (res.status === 400 && !(await regionVoices(cfg).catch(() => null))?.has(name)) {
      throw new TtsUnavailable(`${name} isn't offered in your Azure region (${cfg.region})`);
    }
    throw new Error(`Azure answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length > 8 * 1024 * 1024) throw new Error("azure returned too much audio");
  return { audio, type: "audio/mpeg", ext: "mp3" };
}
