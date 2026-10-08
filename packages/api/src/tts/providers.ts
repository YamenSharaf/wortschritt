import { eq } from "drizzle-orm";
import { NEURAL_VOICES, ttsProviderOf, type TtsAdminSettings, type TtsProvider } from "@mdb/shared";
import { guardedFetch } from "../assistant/egress";
import { decryptSecret, encryptSecret, isEncryptionAvailable } from "../assistant/secrets";
import { db, schema } from "../db/client";
import { edgeSynthesize } from "./edge";

/**
 * Read-aloud providers. A voice id says which one speaks it:
 * - Azure Speech neural voices (admin stores a key + region): "azure:<name>";
 * - the Edge "Read aloud" endpoint (unofficial, admin opt-in): "edge:<name>".
 * Settings live in app_settings; the Azure key is encrypted like AI keys.
 */

const AZURE_KEY = "tts.azure";
const EDGE_KEY = "tts.edge";

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
  };
}

export class TtsConfigError extends Error {}

/** Change the cloud providers (Azure: key optional = keep the stored one; null = remove). */
export function updateTtsSettings(body: { azure?: { region: string; key?: string } | null; edge?: boolean }): void {
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
}

export type VoiceOption = { id: string; label: string; provider: TtsProvider };

/** Every voice usable right now. */
export function usableVoices(): VoiceOption[] {
  const out: VoiceOption[] = [];
  if (azureConfig()) for (const v of NEURAL_VOICES) out.push({ id: `azure:${v.name}`, label: `${v.label} · Azure`, provider: "azure" });
  if (edgeEnabled()) for (const v of NEURAL_VOICES) out.push({ id: `edge:${v.name}`, label: `${v.label} · Edge`, provider: "edge" });
  return out;
}

const NEURAL_NAMES = new Set<string>(NEURAL_VOICES.map((v) => v.name));
const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export class TtsUnavailable extends Error {}

/** Synthesize with whichever provider the voice belongs to. */
export async function synthesize(text: string, voice: string): Promise<{ audio: Buffer; type: string; ext: string }> {
  const provider = ttsProviderOf(voice);
  if (!provider) throw new TtsUnavailable(`unknown voice "${voice}"`);
  const name = voice.slice(provider.length + 1);
  if (!NEURAL_NAMES.has(name)) throw new TtsUnavailable(`unknown voice "${voice}"`);
  if (provider === "edge") {
    if (!edgeEnabled()) throw new TtsUnavailable("Edge voices are turned off");
    return { audio: await edgeSynthesize(text, name), type: "audio/mpeg", ext: "mp3" };
  }
  const cfg = azureConfig();
  if (!cfg) throw new TtsUnavailable("Azure Speech isn't set up");
  const lang = name.split("-").slice(0, 2).join("-");
  const res = await guardedFetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": cfg.key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "wortschritt",
    },
    body: `<speak version='1.0' xml:lang='${lang}'><voice name='${name}'>${xmlEscape(text)}</voice></speak>`,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`azure ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length > 8 * 1024 * 1024) throw new Error("azure returned too much audio");
  return { audio, type: "audio/mpeg", ext: "mp3" };
}
