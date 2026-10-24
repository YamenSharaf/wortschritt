import { eq } from "drizzle-orm";
import { GEMINI_TTS_MODELS, serverVoices, ttsProviderOf, type TtsAdminSettings, type TtsProvider } from "@mdb/shared";
import { guardedFetch } from "../assistant/egress";
import { decryptSecret, encryptSecret, isEncryptionAvailable } from "../assistant/secrets";
import { db, schema } from "../db/client";
import { edgeSynthesize } from "./edge";
import { GeminiLimitError, geminiSynthesize } from "./gemini";

/**
 * Read-aloud providers. A voice id says which one speaks it:
 * - Azure Speech neural voices (admin stores a key + region): "azure:<name>";
 * - the Edge "Read aloud" endpoint (unofficial, admin opt-in): "edge:<name>";
 * - Gemini text-to-speech (admin stores a Google AI Studio key): "gemini:<name>".
 * Settings live in app_settings; the keys are encrypted like AI keys.
 */

const AZURE_KEY = "tts.azure";
const EDGE_KEY = "tts.edge";
const GEMINI_KEY = "tts.gemini";
type GeminiModel = (typeof GEMINI_TTS_MODELS)[number];

type AzureConfig = { region: string; key: string };

function readSetting(key: string): string | null {
  return db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get()?.value ?? null;
}
function writeSetting(key: string, value: string | null): void {
  if (value === null) {
    db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run();
    return;
  }
  db.insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
    .run();
}

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

function geminiStored(): { key: string; model: GeminiModel } | null {
  const raw = readSetting(GEMINI_KEY);
  if (!raw) return null;
  try {
    const { key, model } = JSON.parse(raw) as { key: string; model?: string };
    return { key, model: (GEMINI_TTS_MODELS as readonly string[]).includes(model ?? "") ? (model as GeminiModel) : GEMINI_TTS_MODELS[0] };
  } catch {
    return null;
  }
}
function geminiConfig(): { key: string; model: GeminiModel } | null {
  const stored = geminiStored();
  const key = stored && decryptSecret(stored.key);
  return stored && key ? { key, model: stored.model } : null;
}

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
    gemini: { configured: geminiConfig() !== null, model: geminiStored()?.model ?? GEMINI_TTS_MODELS[0] },
  };
}

export class TtsConfigError extends Error {}

/** Change the cloud providers (Azure: key optional = keep the stored one; null = remove). */
export function updateTtsSettings(body: {
  azure?: { region: string; key?: string } | null;
  edge?: boolean;
  gemini?: { key?: string; model: GeminiModel } | null;
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
  if (body.gemini === null) writeSetting(GEMINI_KEY, null);
  else if (body.gemini) {
    let stored = geminiStored()?.key ?? null;
    if (body.gemini.key) {
      if (!isEncryptionAvailable) throw new TtsConfigError("set ENCRYPTION_KEY on the server to store keys");
      stored = encryptSecret(body.gemini.key);
    }
    if (!stored) throw new TtsConfigError("enter the Gemini API key");
    writeSetting(GEMINI_KEY, JSON.stringify({ key: stored, model: body.gemini.model }));
  }
}

export type VoiceOption = { id: string; label: string; provider: TtsProvider };

/** Every voice usable right now. */
export function usableVoices(): VoiceOption[] {
  const out: VoiceOption[] = [];
  if (azureConfig()) for (const v of serverVoices("azure")) out.push({ id: `azure:${v.name}`, label: `${v.label} · Azure`, provider: "azure" });
  if (edgeEnabled()) for (const v of serverVoices("edge")) out.push({ id: `edge:${v.name}`, label: `${v.label} · Edge`, provider: "edge" });
  if (geminiConfig()) for (const v of serverVoices("gemini")) out.push({ id: `gemini:${v.name}`, label: `${v.label} · Gemini`, provider: "gemini" });
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

export class TtsUnavailable extends Error {}
/** The provider's limit is reached for now; `retryAfter` is when to try again (seconds), if it says. */
export class TtsRateLimited extends TtsUnavailable {
  constructor(
    message: string,
    public retryAfter: number | null,
  ) {
    super(message);
  }
}

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

/** Synthesize with whichever provider the voice belongs to. */
export async function synthesize(text: string, voice: string): Promise<{ audio: Buffer; type: string; ext: string }> {
  const provider = ttsProviderOf(voice);
  if (!provider) throw new TtsUnavailable(`unknown voice "${voice}"`);
  const name = voice.slice(provider.length + 1);
  if (!VOICE_NAMES[provider].has(name)) throw new TtsUnavailable(`unknown voice "${voice}"`);
  if (provider === "edge") {
    if (!edgeEnabled()) throw new TtsUnavailable("Edge voices are turned off");
    return { audio: await edgeSynthesize(text, name), type: "audio/mpeg", ext: "mp3" };
  }
  if (provider === "gemini") {
    const cfg = geminiConfig();
    if (!cfg) throw new TtsUnavailable("Gemini isn't set up");
    try {
      return { audio: await geminiSynthesize(text, name, cfg), type: "audio/mpeg", ext: "mp3" };
    } catch (err) {
      if (err instanceof GeminiLimitError) throw new TtsRateLimited(err.message, err.retryAfter);
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
