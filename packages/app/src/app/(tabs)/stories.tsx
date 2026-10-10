import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useApi, useAsync } from "@mdb/client/react";
import { font, useTheme } from "@/lib/theme";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Stories (for now: a plain list that opens the reader spike). */
export default function Stories() {
  const api = useApi();
  const { colors } = useTheme();
  const stories = useAsync(() => api.stories(), [api]);
  return (
    <Screen>
      <Text variant="title">Stories</Text>
      <Text variant="muted">Reader spike: open a story to compare the two reading engines.</Text>
      {stories.status === "ready" && (
        <Card>
          {stories.data.map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => router.push(`/reader/${s.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.border,
                backgroundColor: pressed ? colors.surfaceSunken : "transparent",
              })}
            >
              <Text style={{ fontFamily: font.medium }}>{s.title}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Text variant="subtle">{s.level}</Text>
                <Text variant="subtle">· {s.status === "read" ? "read" : s.status === "reading" ? "reading" : "unread"}</Text>
              </View>
            </Pressable>
          ))}
        </Card>
      )}
      {stories.status === "error" && <Text style={{ color: colors.danger }}>Couldn't load your stories.</Text>}
    </Screen>
  );
}
