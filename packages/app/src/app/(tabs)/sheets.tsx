import { useMemo, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useApi, useAsync } from "@mdb/client/react";
import { StarButton } from "@/ui/StarButton";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Segmented } from "@/reader/ReaderSheets";
import { IconTile } from "@/ui/IconTile";
import { PressCard } from "@/ui/PressCard";
import { sections } from "@/ui/icons";
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
      </View>
      <Text variant="muted">Grammar at a glance. Tap any word to look it up.</Text>
      {/* Search and sort on one line (search once there are a few). */}
      {list.length > 1 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>{list.length > 3 && <SearchField value={q} onChange={setQ} placeholder="Search cheat sheets…" />}</View>
          <Segmented
            compact
            value={sort}
            options={[
              ["recent", "Recent"],
              ["az", "A–Z"],
            ]}
            onChange={setSort}
          />
        </View>
      )}
      {sheets.status === "error" && <Text style={{ color: colors.danger }}>Couldn't load the cheat sheets. Pull to try again.</Text>}
      {sheets.status === "ready" && list.length === 0 && <Text variant="muted">No cheat sheets yet.</Text>}
      {sheets.status === "ready" && list.length > 0 && shown.length === 0 && <Text variant="muted">No cheat sheets match.</Text>}
      <View style={{ gap: 12 }}>
        {shown.map((s) => (
          <PressCard key={s.id} onPress={() => router.push(`/sheet/${s.id}`)} style={{ padding: 16, flexDirection: "row", gap: 12 }}>
            <IconTile icon={sections.sheets.icon} color={colors.sectionSheets} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={{ fontFamily: font.semibold }}>{s.title}</Text>
              {s.subtitle ? <Text variant="muted">{s.subtitle}</Text> : null}
              {s.category ? (
                <View style={{ flexDirection: "row", marginTop: 8 }}>
                  <Pill text={s.category} />
                </View>
              ) : null}
            </View>
            <StarButton kind="cheatsheet" id={s.id} title={s.title} />
          </PressCard>
        ))}
      </View>
    </Screen>
  );
}
