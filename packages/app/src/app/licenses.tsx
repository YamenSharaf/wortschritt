import { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { notices, type NoticeGroup } from "@mdb/client/notices";
import { font, useTheme } from "@/lib/theme";
import { Icon } from "@/ui/icons";
import { Text } from "@/ui/Text";
import { ChevronDown, ChevronLeft, ChevronUp } from "lucide-react-native";

type Row = { key: string; title: string; license: string; note?: string; text: string | null };

/** Open-source licences: the bundled assets, then every package (grouped by licence text); tap one for its licence. */
export default function Licenses() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<string | null>(null);
  const rows: Row[] = [
    ...notices.assets.map((a, i) => ({ key: `a${i}`, title: a.name, license: a.license, note: a.note, text: a.text })),
    ...notices.groups.map((g: NoticeGroup, i) => ({
      key: `g${i}`,
      title: g.packages.map((p) => `${p.name} ${p.version}`).join(", "),
      license: g.license,
      text: g.text,
    })),
  ];
  const packageCount = notices.groups.reduce((n, g) => n + g.packages.length, 0);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        initialNumToRender={20}
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24, paddingHorizontal: 20, gap: 8 }}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 8 }}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 }}>
              <Icon icon={ChevronLeft} size={18} color={colors.inkMuted} />
              <Text style={{ fontFamily: font.medium, color: colors.inkMuted }}>Account</Text>
            </Pressable>
            <Text variant="title">Open-source licences</Text>
            <Text variant="muted">
              Wortschritt is MIT licensed and is built on the work of others: {notices.assets.length} bundled assets and {packageCount} packages. Tap one for its licence.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const expanded = open === item.key;
          return (
            <Pressable
              onPress={() => setOpen(expanded ? null : item.key)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 6 }}
            >
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 14 }} numberOfLines={expanded ? undefined : 2}>
                  {item.title}
                </Text>
                <Icon icon={expanded ? ChevronUp : ChevronDown} size={14} color={colors.inkSubtle} />
              </View>
              <Text variant="subtle">{item.license}</Text>
              {expanded && item.note ? <Text variant="muted" style={{ fontSize: 13 }}>{item.note}</Text> : null}
              {expanded && (
                <Text style={{ fontFamily: font.mono, fontSize: 11, lineHeight: 16, color: colors.inkMuted }} selectable>
                  {item.text ?? "No licence file in the package; see its declared licence above."}
                </Text>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
