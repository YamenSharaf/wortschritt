import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import type { RunSummary } from "@mdb/shared";
import { timeAgo } from "@mdb/client";
import { useApi, useAsync } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Card } from "@/ui/Card";
import { Icon, sections } from "@/ui/icons";
import { Pill } from "@/ui/Pill";
import { Screen } from "@/ui/Screen";
import { SearchField, sortByMode } from "@/ui/SearchField";
import { Segmented } from "@/reader/ReaderSheets";
import { Text } from "@/ui/Text";

/** Exercise sets (from the device once synced), with each one's last score as the server reads it. */
export default function Practice() {
  const api = useApi();
  const { colors } = useTheme();
  const { status, syncNow } = useSync();
  const sets = useAsync(() => api.exercises(), [api, status.revision], { keep: true });
  const runs = useAsync(() => api.runs(), [api, status.revision], { keep: true });
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "az">("recent");
  const last: Record<string, RunSummary> = {};
  if (runs.status === "ready") for (const r of runs.data) last[r.setId] ??= r;

  const list = sets.status === "ready" ? sets.data : [];
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    const found = n ? list.filter((s) => [s.title, s.subtitle, s.description, ...s.tags].some((v) => (v ?? "").toLowerCase().includes(n))) : list;
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
        <Text variant="title">Practice</Text>
      </View>
      <Text variant="muted">Exercise sets for grammar and vocabulary. Wrong answers come back until you get them.</Text>
      {/* Search and sort on one line (search once there are a few). */}
      {list.length > 1 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>{list.length > 3 && <SearchField value={q} onChange={setQ} placeholder="Search exercises…" />}</View>
          <Segmented compact value={sort} options={[["recent", "Recent"], ["az", "A–Z"]]} onChange={setSort} />
        </View>
      )}
      {sets.status === "error" && <Text style={{ color: colors.danger }}>Couldn't load the exercises. Pull to try again.</Text>}
      {sets.status === "ready" && list.length === 0 && <Text variant="muted">No exercises yet. Import some under Account › Import content.</Text>}
      {sets.status === "ready" && list.length > 0 && shown.length === 0 && <Text variant="muted">No exercises match.</Text>}
      <View style={{ gap: 12 }}>
        {shown.map((s) => (
          <Pressable key={s.id} onPress={() => router.push(`/practice/${s.id}`)} accessibilityRole="button">
            {({ pressed }) => (
              <Card style={{ padding: 16, gap: 10, backgroundColor: pressed ? colors.surfaceSunken : colors.surface }}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Icon icon={sections.practice.icon} size={20} color={colors.sectionPractice} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: font.semibold }}>{s.title}</Text>
                    {s.subtitle ? <Text variant="muted">{s.subtitle}</Text> : null}
                  </View>
                </View>
                {s.description ? <Text variant="muted" style={{ fontSize: 14, lineHeight: 20 }}>{s.description}</Text> : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <Pill text={s.level} />
                  <Pill text={`${s.items.length} tasks`} />
                  {s.tags.slice(0, 2).map((t) => (
                    <Pill key={t} text={t} />
                  ))}
                  <View style={{ flex: 1 }} />
                  <LastRun run={last[s.id]} />
                </View>
              </Card>
            )}
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

/** "Last: 15/21", tinted as the server reads the score. */
function LastRun({ run }: { run?: RunSummary }) {
  const { colors } = useTheme();
  if (!run) return null;
  const tone = run.tier === "good" ? colors.success : run.tier === "ok" ? colors.warning : colors.danger;
  return (
    <Text variant="subtle" accessibilityLabel={`Last run ${timeAgo(run.finishedAt)}: ${run.correct} of ${run.answered}`}>
      Last: <Text style={{ fontFamily: font.medium, fontSize: 13, color: tone }}>{`${run.correct}/${run.answered}`}</Text>
    </Text>
  );
}
