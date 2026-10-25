import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { recentReading, type ReadingItem } from "@mdb/client";
import { useApi, useAsync } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Card } from "./Card";
import { Cover } from "./Cover";
import { Text } from "./Text";

/** What to read next (books and stories in progress, else the newest unread), from the device. */
export function useRecentReading(limit: number): { items: ReadingItem[]; reading: boolean } | null {
  const api = useApi();
  const rev = useSync().status.revision;
  const stories = useAsync(() => api.stories(), [api, rev], { keep: true });
  const books = useAsync(() => api.seriesList(), [api, rev], { keep: true });
  if (stories.status !== "ready" || books.status !== "ready") return null;
  return recentReading(stories.data, books.data, limit);
}

/** The list: a cover, the title and how far along; a tap carries on reading. */
export function RecentReading({ items }: { items: ReadingItem[] }) {
  const { colors } = useTheme();
  return (
    <Card>
      {items.map((it, i) => (
        <Pressable
          key={`${it.kind}:${it.id}`}
          onPress={() => router.push(`/reader/${it.storyId}`)}
          accessibilityRole="button"
          accessibilityLabel={`${it.title}, ${it.detail}`}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: colors.border,
            backgroundColor: pressed ? colors.surfaceSunken : "transparent",
          })}
        >
          <Cover kind={it.kind} id={it.id} version={it.cover} fallbackKey={it.coverKey} width={32} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.medium }}>
              {it.title}
            </Text>
            <Text variant="subtle">{it.detail}</Text>
          </View>
        </Pressable>
      ))}
    </Card>
  );
}
