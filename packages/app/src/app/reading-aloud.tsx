import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { router } from "expo-router";
import { GEMINI_TTS_MODELS, type MyVoices, type Settings, type StoryAudioBrief, type TtsEntryView, type TtsKeyView, type TtsStatus } from "@mdb/shared";
import { retryText, serverTtsFor, type TtsEntryBody, type TtsKeyBody } from "@mdb/client";
import { useApi, useSpeech } from "@mdb/client/react";
import { useListening } from "@/lib/listening";
import { font, useTheme } from "@/lib/theme";
import { Segmented, Sheet } from "@/reader/ReaderSheets";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Icon } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { ChevronRight, Play } from "lucide-react-native";

const modelName = (m: string) => (m.includes("lite") ? "Flash-Lite" : "Flash");
const USES = [
  ["background", "Background"],
  ["waiting", "When waiting"],
  ["taps", "Taps"],
] as const;
const PROVIDER = { azure: "Azure", edge: "Edge", gemini: "Gemini" } as const;

/**
 * Reading aloud (as Settings › Reading aloud on the web): the voices,
 * audiobooks made ahead of time, and your own voice keys and their order
 * (optional: without them the server's are used, as far as the admin shares
 * them). Every change is saved at once.
 */
export default function ReadingAloud() {
  const api = useApi();
  const speech = useSpeech();
  const { controller: listening } = useListening();
  const { colors } = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [mine, setMine] = useState<MyVoices | null>(null);
  const [audio, setAudio] = useState<StoryAudioBrief[]>([]);
  const [picking, setPicking] = useState<null | "words" | "reading">(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    api.myVoices().then(setMine).catch(() => {});
    api.ttsStatus().then(setStatus).catch(() => {});
  };
  useEffect(() => {
    api.settings().then(setSettings).catch(() => setError("Settings need a connection to the server."));
    api.allStoryAudio().then((a) => setAudio(Object.values(a))).catch(() => {});
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  /** Save a change at once, merged into the latest settings; the voices take effect straight away. */
  async function change(patch: Partial<Settings>) {
    if (!settings) return;
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    try {
      const saved = await api.saveSettings({ ...(await api.settings()), ...patch });
      setSettings(saved);
      if (status) {
        const tts = serverTtsFor(status, saved);
        speech.setServerTts(tts);
        listening?.setEnabled(tts.readerEnabled);
      }
    } catch {
      setError("Couldn't save. Check the connection and try again.");
    }
  }
  async function keys(fn: () => Promise<MyVoices>) {
    try {
      setMine(await fn());
      api.ttsStatus().then(setStatus).catch(() => {});
    } catch (e) {
      Alert.alert("Couldn't change your keys", e instanceof Error ? e.message : String(e));
    }
  }

  const voices = status?.available ? status.voices.filter((v) => status.installed.includes(v.id)) : [];
  const voiceLabel = (id: string, fallback: string) => (id === "" ? fallback : id === "device" ? "Device voice" : (voices.find((v) => v.id === id)?.label ?? `${id} (not available now)`));
  const ready = audio.filter((b) => b.state === "ready");
  const minutes = Math.round(ready.reduce((n, b) => n + b.duration, 0) / 60);

  return (
    <Screen dock={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="title">Reading aloud</Text>
        <Button kind="ghost" label="Done" onPress={() => router.back()} />
      </View>
      {error && <Text style={{ color: colors.danger }}>{error}</Text>}
      {!settings ? (
        !error && <Text variant="muted">Loading…</Text>
      ) : (
        <>
          <View style={{ gap: 10 }}>
            <Text variant="eyebrow">VOICES</Text>
            <Card>
              <VoiceRow
                title="Words and sentences"
                value={voiceLabel(settings.ttsVoice, "Device voice")}
                onPick={() => setPicking("words")}
                onHear={() => speech.speak("Guten Tag! Ich lerne Deutsch.")}
              />
              <VoiceRow
                title="Stories and audiobooks"
                value={voiceLabel(settings.readerVoice, "Same as for words")}
                onPick={() => setPicking("reading")}
                onHear={() => void speech.speakSequence(["Es war einmal ein kleines Dorf am Rand eines großen Waldes."])}
                divider
              />
            </Card>
            <Text variant="subtle">Speed: the reader's own (Aa in the reader) for the phone's voice, the player's own while listening.</Text>
          </View>

          <View style={{ gap: 10 }}>
            <Text variant="eyebrow">AUDIOBOOKS</Text>
            <Card style={{ padding: 16, gap: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: font.medium }}>Generate automatically</Text>
                  <Text variant="subtle">The audio for your stories ahead of time: next chapters of books you're reading, then unread, then read ones. With Background keys only.</Text>
                </View>
                <Switch
                  value={settings.audiobooks.auto}
                  onValueChange={(auto) => void change({ audiobooks: { ...settings.audiobooks, auto } })}
                  accessibilityLabel="Generate audiobooks automatically"
                  trackColor={{ true: colors.brand, false: colors.borderControl }}
                  thumbColor={colors.surface}
                />
              </View>
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: font.medium }}>Keep for me each day</Text>
                <Segmented
                  value={String(settings.audiobooks.reserve)}
                  options={[0.1, 0.2, 0.3, 0.5].map((r) => [String(r), `${Math.round(r * 100)}%`] as [string, string])}
                  onChange={(v) => void change({ audiobooks: { ...settings.audiobooks, reserve: Number(v) } })}
                />
                <Text variant="subtle">Of each key's daily requests, for taps and what you ask for.</Text>
              </View>
              {audio.length > 0 && (
                <Text variant="muted">
                  With audio: {ready.length} of {audio.length}
                  {minutes ? ` · ${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} h ` : ""}${minutes % 60} min` : ""}
                </Text>
              )}
            </Card>
          </View>

          {mine && <MyKeys mine={mine} change={keys} />}
        </>
      )}

      {picking && settings && (
        <Sheet title={picking === "words" ? "Words and sentences" : "Stories and audiobooks"} onClose={() => setPicking(null)}>
          <ScrollView style={{ maxHeight: 420 }}>
            {(picking === "reading" ? [["", "Same as for words"], ["device", "Device voice"]] : [["", "Device voice"]]).map(([id, label]) => (
              <Option key={id} label={label!} on={(picking === "words" ? settings.ttsVoice : settings.readerVoice) === id} onPress={() => {
                void change(picking === "words" ? { ttsVoice: id } : { readerVoice: id });
                setPicking(null);
              }} />
            ))}
            {(["gemini", "azure", "edge"] as const).map((p) => {
              const list = voices.filter((v) => v.provider === p);
              if (!list.length) return null;
              return (
                <View key={p} style={{ marginTop: 12 }}>
                  <Text variant="eyebrow">{PROVIDER[p].toUpperCase()}</Text>
                  {list.map((v) => (
                    <Option
                      key={v.id}
                      label={v.label.replace(/ · (Azure|Edge|Gemini)$/, "")}
                      on={(picking === "words" ? settings.ttsVoice : settings.readerVoice) === v.id}
                      onPress={() => {
                        void change(picking === "words" ? { ttsVoice: v.id } : { readerVoice: v.id });
                        setPicking(null);
                      }}
                    />
                  ))}
                </View>
              );
            })}
          </ScrollView>
        </Sheet>
      )}
    </Screen>
  );
}

function VoiceRow({ title, value, onPick, onHear, divider }: { title: string; value: string; onPick: () => void; onHear: () => void; divider?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: divider ? 1 : 0, borderTopColor: colors.border }}>
      <Pressable onPress={onPick} accessibilityRole="button" accessibilityLabel={`${title}: ${value}. Change`} style={{ flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: font.semibold }}>{title}</Text>
          <Text variant="subtle" numberOfLines={1}>
            {value}
          </Text>
        </View>
        <Icon icon={ChevronRight} size={18} color={colors.inkSubtle} />
      </Pressable>
      <Pressable onPress={onHear} accessibilityRole="button" accessibilityLabel={`Hear ${title.toLowerCase()}`} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft }}>
        <Icon icon={Play} size={14} color={colors.brandInk} fill={colors.brandInk} />
      </Pressable>
    </View>
  );
}

function Option({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors, radii } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: radii.control, backgroundColor: on ? colors.brandSoft : "transparent" }}
    >
      <Text style={{ fontFamily: on ? font.semibold : font.regular, color: on ? colors.brandInk : colors.ink }}>{label}</Text>
    </Pressable>
  );
}

type Form = { id?: number; provider: "gemini" | "azure"; label: string; kind: "free" | "paid"; region: string; key: string };

/** Your own keys (Gemini, one Azure) and your order for Gemini voices, then the server's. */
function MyKeys({ mine, change }: { mine: MyVoices; change: (fn: () => Promise<MyVoices>) => Promise<void> }) {
  const api = useApi();
  const { colors, radii } = useTheme();
  const [form, setForm] = useState<Form | null>(null);
  const gemini = mine.keys.filter((k) => k.provider === "gemini");
  const azure = mine.keys.find((k) => k.provider === "azure");
  const keyOf = (id: number) => mine.keys.find((k) => k.id === id);
  const save = (list: Pick<TtsEntryView, "keyId" | "model" | "background" | "waiting" | "taps">[]) =>
    change(() => api.setMyVoiceEntries(list.map(({ keyId, model, background, waiting, taps }): TtsEntryBody => ({ keyId, model, background, waiting, taps }))));
  const missing = gemini.flatMap((k) => GEMINI_TTS_MODELS.filter((m) => !mine.entries.some((e) => e.keyId === k.id && e.model === m)).map((m) => ({ key: k, model: m })));

  if (!mine.canStoreKey)
    return (
      <View style={{ gap: 10 }}>
        <Text variant="eyebrow">YOUR VOICE KEYS</Text>
        <Text variant="subtle">The server can't store keys (it needs ENCRYPTION_KEY set).</Text>
      </View>
    );

  const input = { minHeight: 44, paddingHorizontal: 14, borderRadius: radii.control, borderWidth: 1, borderColor: colors.borderControl, backgroundColor: colors.surface, color: colors.ink, fontFamily: font.regular } as const;

  return (
    <View style={{ gap: 10 }}>
      <Text variant="eyebrow">YOUR VOICE KEYS · OPTIONAL</Text>
      <Text variant="subtle">Without your own, the server's voices are used. Yours are tried first, for your stories and taps only.</Text>
      <Card>
        {[...gemini, ...(azure ? [azure] : [])].map((k: TtsKeyView, i) => (
          <Pressable
            key={k.id}
            onPress={() => setForm({ id: k.id, provider: k.provider, label: k.label, kind: k.kind, region: k.region ?? "", key: "" })}
            onLongPress={() =>
              Alert.alert(`Remove “${k.label}”?`, k.provider === "gemini" ? "Its place in your order goes too." : "Azure's voices then come from the server, if it shares them.", [
                { text: "Cancel", style: "cancel" },
                { text: "Remove", style: "destructive", onPress: () => void change(() => api.deleteMyVoiceKey(k.id)) },
              ])
            }
            accessibilityRole="button"
            accessibilityHint="Long press to remove"
            style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: font.semibold }}>{k.label}</Text>
              <Text variant="subtle">
                {k.provider === "azure" ? `Azure · ${k.region}` : "Gemini"} · ····{k.hint}
              </Text>
            </View>
            <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 999, justifyContent: "center", backgroundColor: k.kind === "free" ? colors.successSoft : colors.brandSoft }}>
              <Text style={{ fontSize: 12, fontFamily: font.medium, color: k.kind === "free" ? colors.success : colors.brandInk }}>{k.kind === "free" ? "Free" : "Paid"}</Text>
            </View>
          </Pressable>
        ))}
        <View style={{ flexDirection: "row", borderTopWidth: mine.keys.length ? 1 : 0, borderTopColor: colors.border }}>
          <Pressable onPress={() => setForm({ provider: "gemini", label: gemini.length ? "Paid" : "Free", kind: gemini.length ? "paid" : "free", region: "", key: "" })} accessibilityRole="button" style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: font.medium, color: colors.brandInk }}>Add Gemini key</Text>
          </Pressable>
          <Pressable onPress={() => setForm({ provider: "azure", label: "Azure", kind: "free", region: azure?.region ?? "", key: "" })} accessibilityRole="button" style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderLeftWidth: 1, borderLeftColor: colors.border }}>
            <Text style={{ fontFamily: font.medium, color: colors.brandInk }}>{azure ? "Replace Azure key" : "Add Azure key"}</Text>
          </Pressable>
        </View>
      </Card>

      <Text variant="eyebrow" style={{ marginTop: 6 }}>
        ORDER FOR GEMINI VOICES
      </Text>
      {mine.entries.map((e, i) => {
        const k = keyOf(e.keyId);
        const set = (patch: Partial<TtsEntryView>) => void save(mine.entries.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        const move = (to: number) => {
          const list = [...mine.entries];
          const [it] = list.splice(i, 1);
          list.splice(to, 0, it!);
          void save(list);
        };
        const used = e.limitedUntil ? `Used up · back ${retryText(e.limitedUntil)}` : `${e.usedToday} of ${e.dailyLimit} today`;
        return (
          <Card key={e.id} style={{ padding: 12, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontFamily: font.mono, fontSize: 12, color: colors.inkSubtle }}>{i + 1}</Text>
              <Text style={{ fontFamily: font.semibold, flex: 1 }} numberOfLines={1}>
                {k?.label} · {modelName(e.model)}
              </Text>
              <Text style={{ fontSize: 13, color: e.limitedUntil ? colors.warning : colors.inkMuted }}>{used}</Text>
            </View>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
              <View style={{ width: `${Math.min(100, (e.usedToday / e.dailyLimit) * 100)}%`, height: "100%", backgroundColor: e.limitedUntil ? colors.warning : colors.brand }} />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {USES.map(([use, label]) => (
                <Pressable
                  key={use}
                  onPress={() => set({ [use]: !e[use] })}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: e[use] }}
                  style={{
                    minHeight: 36,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: e[use] ? "transparent" : colors.borderControl,
                    backgroundColor: e[use] ? colors.brandSoft : "transparent",
                  }}
                >
                  <Text style={{ fontSize: 12, fontFamily: font.medium, color: e[use] ? colors.brandInk : colors.inkMuted }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button kind="ghost" label="↑ Up" disabled={i === 0} onPress={() => move(i - 1)} />
              <Button kind="ghost" label="↓ Down" disabled={i === mine.entries.length - 1} onPress={() => move(i + 1)} />
              <View style={{ flex: 1 }} />
              <Button kind="ghost" label="Take out" onPress={() => void save(mine.entries.filter((_, j) => j !== i))} />
            </View>
          </Card>
        );
      })}
      {missing.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {missing.map((m) => (
            <Button
              key={`${m.key.id}:${m.model}`}
              label={`Add ${m.key.label} · ${modelName(m.model)}`}
              onPress={() => void save([...mine.entries, { keyId: m.key.id, model: m.model, background: m.key.kind === "free", waiting: true, taps: true }])}
            />
          ))}
        </View>
      )}
      <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, borderRadius: radii.card, padding: 12, gap: 2 }}>
        <Text style={{ fontFamily: font.semibold, color: colors.inkMuted }}>Then the server's voices</Text>
        <Text variant="subtle">
          {mine.server.entries.length
            ? mine.server.entries.map((s) => `${s.label} · ${modelName(s.model)}`).join(", ") + ". Set up by the admin."
            : "None shared with you."}
        </Text>
      </View>

      {form && (
        <Sheet title={form.id ? `Change “${form.label}”` : form.provider === "azure" ? "Your Azure key" : "Your Gemini key"} onClose={() => setForm(null)}>
          <View style={{ gap: 12 }}>
            <TextInput value={form.label} onChangeText={(label) => setForm({ ...form, label })} placeholder="Name, e.g. Free" accessibilityLabel="Name" style={input} placeholderTextColor={colors.inkSubtle} />
            <Segmented value={form.kind} options={[["free", "Free (no billing)"], ["paid", "Paid (billing)"]]} onChange={(kind) => setForm({ ...form, kind })} />
            {form.provider === "azure" && (
              <TextInput
                value={form.region}
                onChangeText={(region) => setForm({ ...form, region: region.trim().toLowerCase() })}
                placeholder="Region, e.g. swedencentral"
                accessibilityLabel="Azure region"
                autoCapitalize="none"
                autoCorrect={false}
                style={input}
                placeholderTextColor={colors.inkSubtle}
              />
            )}
            <TextInput
              value={form.key}
              onChangeText={(key) => setForm({ ...form, key })}
              placeholder={`${form.provider === "azure" ? "Azure Speech key" : "Gemini API key"}${form.id ? " (leave empty to keep)" : ""}`}
              accessibilityLabel="Key"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={input}
              placeholderTextColor={colors.inkSubtle}
            />
            <Text variant="subtle">
              {form.provider === "azure"
                ? "From your Azure Speech resource (its free tier has 0.5 million characters a month). It's stored encrypted and used for your voices only."
                : "From Google AI Studio. A project without billing is free (10 requests a day per model; Google may use what's read); with billing each request costs. Stored encrypted, used for you only."}
            </Text>
            <Button
              kind="primary"
              label={form.id ? "Save" : "Add"}
              disabled={!form.label.trim() || (!form.id && !form.key) || (form.provider === "azure" && !form.region)}
              onPress={() => {
                const body: TtsKeyBody = { provider: form.provider, label: form.label.trim(), kind: form.kind, ...(form.provider === "azure" ? { region: form.region } : {}), ...(form.key ? { key: form.key.trim() } : {}) };
                void change(() => (form.id ? api.updateMyVoiceKey(form.id, body) : api.addMyVoiceKey(body))).then(() => setForm(null));
              }}
            />
          </View>
        </Sheet>
      )}
    </View>
  );
}
