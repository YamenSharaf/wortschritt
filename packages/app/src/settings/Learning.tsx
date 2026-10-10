import { useEffect, useState } from "react";
import { Switch, TextInput, View } from "react-native";
import { generateCounts, type Settings } from "@mdb/shared";
import { useApi } from "@mdb/client/react";
import { font, useTheme } from "@/lib/theme";
import { Segmented } from "@/reader/ReaderSheets";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/**
 * The account's learning settings (all devices): name, level, daily goal,
 * batch size, AI grading. Each change is saved at once, merged into the
 * latest settings so a stale copy can't undo another device's change.
 */
export function LearningSettings() {
  const api = useApi();
  const { colors, radii } = useTheme();
  const [form, setForm] = useState<Settings | null>(null);
  const [name, setName] = useState("");
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setForm(s);
        setName(s.displayName);
      })
      .catch(() => setState("error"));
  }, [api]);

  async function change(patch: Partial<Settings>) {
    if (!form) return;
    setForm({ ...form, ...patch });
    setState("saving");
    try {
      const latest = await api.settings();
      const next = { ...latest, ...patch };
      await api.saveSettings(next);
      setForm(next);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  if (!form)
    return (
      <Card style={{ padding: 16 }}>
        <Text variant="muted">{state === "error" ? "Settings need a connection to the server." : "Loading…"}</Text>
      </Card>
    );

  return (
    <Card style={{ padding: 16, gap: 16 }}>
      <Row label="Display name">
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={() => name.trim() && name.trim() !== form.displayName && void change({ displayName: name.trim() })}
          accessibilityLabel="Display name"
          style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: radii.control, borderWidth: 1, borderColor: colors.borderControl, backgroundColor: colors.surface, color: colors.ink, fontFamily: font.regular }}
        />
      </Row>
      <Row label="Level (CEFR)">
        <Segmented value={form.level} options={LEVELS.map((l) => [l, l] as [Settings["level"], string])} onChange={(level) => void change({ level })} />
      </Row>
      <Row label="Daily goal (tasks)">
        <Segmented
          value={String(form.dailyGoal)}
          options={[...new Set([10, 20, 30, 50, form.dailyGoal])].sort((a, b) => a - b).map((n) => [String(n), String(n)] as [string, string])}
          onChange={(v) => void change({ dailyGoal: Number(v) })}
        />
      </Row>
      <Row label="Exercises to generate per batch" hint="The default for “Generate more” after a set; you can change it there each time.">
        <Segmented value={String(form.generateCount)} options={generateCounts.map((n) => [String(n), String(n)] as [string, string])} onChange={(v) => void change({ generateCount: Number(v) })} />
      </Row>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: font.medium }}>Let the AI tutor grade written answers</Text>
          <Text variant="subtle">Only when the tutor is set up; otherwise answers are matched exactly.</Text>
        </View>
        <Switch
          value={form.llmGrading}
          onValueChange={(llmGrading) => void change({ llmGrading })}
          accessibilityLabel="Let the AI tutor grade written answers"
          trackColor={{ true: colors.brand, false: colors.borderControl }}
          thumbColor={colors.surface}
        />
      </View>
      {state === "saved" && <Text style={{ fontSize: 13, color: colors.success }}>Saved</Text>}
      {state === "error" && <Text style={{ fontSize: 13, color: colors.danger }}>Couldn't save. Check the connection and try again.</Text>}
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: font.medium }}>{label}</Text>
      {children}
      {hint ? <Text variant="subtle">{hint}</Text> : null}
    </View>
  );
}
