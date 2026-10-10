import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useApi, useAsync } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Segmented } from "@/reader/ReaderSheets";
import { Card } from "@/ui/Card";
import { Icon, sections } from "@/ui/icons";
import { Pill } from "@/ui/Pill";
import { Screen } from "@/ui/Screen";
import { SearchField, sortByMode } from "@/ui/SearchField";
import { Text } from "@/ui/Text";

/** Cheat sheets (from the device once synced), as on the web. */
export default function Sheets() {
  const api = useApi();
  const { colors } = useTheme();
  const { status, syncNow } = useSync();
  const sheets = useAsync(() => api.cheatsheets(), [api, status.revision], { keep: true });
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "az">("recent");

  const list = sheets.status === "ready" ? sheets.data : [];
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    const found = n ? list.filter((s) => [s.title, s.subtitle, s.category].some((v) => (v ?? "").toLowerCase().includes(n))) : list;
    return sortByMode(found, sort);
  }, [list, q, sort]);

  return (
    <Screen
      onRefresh={async () => {
        setRefreshing(true);
        await syncNow();
        setRefreshing(false);
      }}
      refreshing={refreshing}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="title">Cheat sheets</Text>
        {list.length > 1 && <Segmented value={sort} options={[["recent", "Recent"], ["az", "A–Z"]]} onChange={setSort} />}
      </View>
      <Text variant="muted">Grammar at a glance. Tap any word to look it up.</Text>
      {list.length > 3 && <SearchField value={q} onChange={setQ} placeholder="Search cheat sheets…" />}
      {sheets.status === "error" && <Text style={{ color: colors.danger }}>Couldn't load the cheat sheets. Pull to try again.</Text>}
      {sheets.status === "ready" && list.length === 0 && <Text variant="muted">No cheat sheets yet.</Text>}
      {sheets.status === "ready" && list.length > 0 && shown.length === 0 && <Text variant="muted">No cheat sheets match.</Text>}
      <View style={{ gap: 12 }}>
        {shown.map((s) => (
          <Pressable key={s.id} onPress={() => router.push(`/sheet/${s.id}`)} accessibilityRole="button">
            {({ pressed }) => (
              <Card style={{ padding: 16, flexDirection: "row", gap: 12, backgroundColor: pressed ? colors.surfaceSunken : colors.surface }}>
                <Icon icon={sections.sheets.icon} size={20} color={colors.sectionSheets} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={{ fontFamily: font.semibold }}>{s.title}</Text>
                  {s.subtitle ? <Text variant="muted">{s.subtitle}</Text> : null}
                  {s.category ? (
                    <View style={{ flexDirection: "row", marginTop: 8 }}>
                      <Pill text={s.category} />
                    </View>
                  ) : null}
                </View>
              </Card>
            )}
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
