import { Pressable, View } from "react-native";
import { router } from "expo-router";
import type { Favorite, RunSummary } from "@mdb/shared";
import { useApi, useAsync } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Card } from "./Card";
import { IconTile } from "./IconTile";
import { Icon, sections } from "./icons";
import { Text } from "./Text";
import { Star } from "lucide-react-native";

type Row = { fav: Favorite; title: string; detail: string; run?: RunSummary };

/** Favourites with what they are (title, size, last score), in the given order. */
export function useFavoriteRows(favorites: Favorite[]): Row[] | null {
  const api = useApi();
  const rev = useSync().status.revision;
  const sets = useAsync(() => api.exercises(), [api, rev], { keep: true });
  const sheets = useAsync(() => api.cheatsheets(), [api, rev], { keep: true });
  const runs = useAsync(() => api.runs(), [api, rev], { keep: true });
  const extra = useAsync(() => api.generatedCounts().catch(() => ({}) as Record<string, number>), [api, rev], { keep: true });
  if (sets.status !== "ready" || sheets.status !== "ready") return null;
  const runBySet = new Map((runs.status === "ready" ? runs.data : []).map((r) => [r.setId, r]));
  return favorites.flatMap((fav): Row[] => {
    if (fav.kind === "exercise") {
      const s = sets.data.find((x) => x.id === fav.id);
      if (!s) return [];
      const n = s.items.length + (extra.status === "ready" ? (extra.data[s.id] ?? 0) : 0);
      return [{ fav, title: s.title, detail: `Exercises · ${n} tasks`, run: runBySet.get(s.id) }];
    }
    const c = sheets.data.find((x) => x.id === fav.id);
    return c ? [{ fav, title: c.title, detail: "Cheat sheet" }] : [];
  });
}

/** Starred sets and sheets as a list; a tap opens one. */
export function FavoriteRows({ rows }: { rows: Row[] }) {
  return (
    <Card>
      {rows.map((r, i) => (
        <FavoriteRow key={`${r.fav.kind}:${r.fav.id}`} row={r} first={i === 0} />
      ))}
    </Card>
  );
}

function FavoriteRow({ row, first }: { row: Row; first: boolean }) {
  const { colors } = useTheme();
  const sheet = row.fav.kind === "cheatsheet";
  const s = sheet ? sections.sheets : sections.practice;
  const run = row.run;
  const tone =
    run?.tier === "good"
      ? { fg: colors.success, bg: colors.successSoft }
      : run?.tier === "weak"
        ? { fg: colors.danger, bg: colors.dangerSoft }
        : { fg: colors.warning, bg: colors.warningSoft };
  return (
    <Pressable
      onPress={() => router.push(sheet ? `/sheet/${row.fav.id}` : `/practice/${row.fav.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${row.detail}${run ? `, last ${run.correct} of ${run.answered}` : ""}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSunken : "transparent",
      })}
    >
      <IconTile icon={s.icon} color={colors[s.tint]} size={32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.medium }}>
          {row.title}
        </Text>
        <Text variant="subtle">{row.detail}</Text>
      </View>
      {run ? (
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: tone.bg }}>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: tone.fg }}>{`${run.correct}/${run.answered}`}</Text>
        </View>
      ) : (
        <Icon icon={Star} size={16} color={colors.reward1} fill={colors.reward1} />
      )}
    </Pressable>
  );
}
