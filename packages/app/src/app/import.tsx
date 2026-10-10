import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Share, TextInput, View } from "react-native";
import { router } from "expo-router";
import type { ImportedItem } from "@mdb/shared";
import { buildImportPrompt, cheatsheet, EXAMPLE_SET, exerciseSet, importBody } from "@mdb/shared";
import { useApi } from "@mdb/client/react";
import { font, useTheme } from "@/lib/theme";
import { Segmented } from "@/reader/ReaderSheets";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Icon } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { ChevronLeft } from "lucide-react-native";

type Kind = "exercise" | "cheatsheet";

/** Paste an exercise set or cheat sheet as JSON (say from an LLM), checked before it's saved; as on the web. */
export default function Import() {
  const api = useApi();
  const { colors, radii } = useTheme();
  const [kind, setKind] = useState<Kind>("exercise");
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ImportedItem[] | null>(null);

  const load = () => api.imports().then(setItems).catch(() => setItems(null));
  useEffect(() => void load(), [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const check = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const r = (kind === "exercise" ? exerciseSet : cheatsheet).safeParse(JSON.parse(text));
      return r.success ? { ok: true as const, count: 0 } : { ok: false as const, count: r.error.issues.length };
    } catch {
      return { ok: false as const, count: -1 };
    }
  }, [text, kind]);

  async function submit() {
    setError(null);
    setMessage(null);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      setError(`Invalid JSON: ${String(e)}`);
      return;
    }
    const body = importBody.safeParse({ kind, data });
    if (!body.success) {
      setError(body.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"));
      return;
    }
    try {
      const res = await api.import(body.data);
      setMessage(`Imported “${res.id}”. It's in ${kind === "exercise" ? "Practice" : "Cheat sheets"} after the next sync.`);
      setText("");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen dock={false}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 }}>
        <Icon icon={ChevronLeft} size={18} color={colors.inkMuted} />
        <Text style={{ fontFamily: font.medium, color: colors.inkMuted }}>Back</Text>
      </Pressable>
      <Text variant="title">Import content</Text>
      <Text variant="muted">Paste JSON (say, written by an LLM). It's checked against the schema before it's saved, and then it's in the shared library.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Segmented value={kind} options={[["exercise", "Exercise"], ["cheatsheet", "Cheat sheet"]]} onChange={setKind} />
        <Button label="Share LLM prompt" onPress={() => void Share.share({ message: buildImportPrompt(kind) })} />
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        textAlignVertical="top"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        placeholder={kind === "exercise" ? JSON.stringify(EXAMPLE_SET, null, 2).slice(0, 300) + "\n…" : "{ \"id\": …, \"title\": …, \"sections\": [ … ] }"}
        placeholderTextColor={colors.inkSubtle}
        accessibilityLabel="JSON to import"
        style={{ minHeight: 260, maxHeight: 420, padding: 12, borderRadius: radii.control, borderWidth: 1, borderColor: colors.borderControl, backgroundColor: colors.surface, color: colors.ink, fontFamily: font.mono, fontSize: 12 }}
      />
      {check && (
        <Text style={{ fontSize: 13, color: check.ok ? colors.success : colors.warning }}>
          {check.ok ? "✓ Schema valid" : check.count < 0 ? "Not valid JSON yet" : `${check.count} validation issue(s)`}
        </Text>
      )}
      <View style={{ flexDirection: "row" }}>
        <Button kind="primary" label="Import" disabled={!check?.ok} onPress={() => void submit()} />
      </View>
      {message && <Text style={{ color: colors.success }}>{message}</Text>}
      {error && (
        <View style={{ padding: 12, borderRadius: radii.control, backgroundColor: colors.dangerSoft }}>
          <Text style={{ fontFamily: font.mono, fontSize: 12, color: colors.danger }}>{error}</Text>
        </View>
      )}

      {items && items.length > 0 && (
        <>
          <Text variant="heading">Imported content</Text>
          <Card>
            {items.map((i, n) => (
              <View key={i.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderTopWidth: n === 0 ? 0 : 1, borderTopColor: colors.border }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: font.medium }}>
                    {i.title}
                  </Text>
                  <Text variant="subtle" numberOfLines={1}>
                    {i.kind === "exercise" ? "Exercise" : "Cheat sheet"} · {i.id}
                    {i.createdBy ? ` · by ${i.createdBy}` : ""}
                  </Text>
                </View>
                {i.canDelete && (
                  <Button
                    label="Delete"
                    onPress={() =>
                      Alert.alert(`Delete “${i.title}” for everyone?`, undefined, [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () =>
                            api
                              .deleteImport(i.id)
                              .then(() => setItems((l) => l?.filter((x) => x.id !== i.id) ?? null))
                              .catch((e) => setError(e instanceof Error ? e.message : String(e))),
                        },
                      ])
                    }
                  />
                )}
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
