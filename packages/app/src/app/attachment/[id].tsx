import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NoteAttachment } from "@mdb/shared";
import { attachmentKind, formatBytes, preferences } from "@mdb/client";
import { usePreference } from "@mdb/client/react";
import { attachmentText, openAttachment } from "@/lib/attachmentFiles";
import { useServer } from "@/lib/server";
import { font, useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/icons";
import { Text } from "@/ui/Text";
import { ChevronLeft, ExternalLink } from "lucide-react-native";

/** One note attachment: text as lines (a transcript can be long), an image fitted to the screen. */
export default function AttachmentScreen() {
  const p = useLocalSearchParams<{ id: string; name: string; type: string; size: string; createdAt: string }>();
  const a: NoteAttachment = useMemo(
    () => ({ id: p.id, name: p.name ?? "File", type: p.type ?? "application/octet-stream", size: Number(p.size) || 0, createdAt: Number(p.createdAt) || 0 }),
    [p.id, p.name, p.type, p.size, p.createdAt],
  );
  const kind = attachmentKind(a.type);
  const { api, mediaHeaders } = useServer();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [fontSize] = usePreference(preferences.noteFontSize);
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api || kind !== "text") return;
    let live = true;
    attachmentText(api, mediaHeaders(), a)
      .then((t) => live && setLines(t.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n")))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [api, a, kind, mediaHeaders]);

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 }}>
        <Icon icon={ChevronLeft} size={18} color={colors.inkMuted} />
        <Text style={{ fontFamily: font.medium, color: colors.inkMuted }}>Note</Text>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 20, lineHeight: 26 }}>{a.name}</Text>
          <Text variant="subtle">{[formatBytes(a.size), lines ? `${lines.length} lines` : ""].filter(Boolean).join(" · ")}</Text>
        </View>
        <Button
          label="Open with…"
          icon={<Icon icon={ExternalLink} size={16} />}
          onPress={() => api && void openAttachment(api, mediaHeaders(), a).catch((e) => setError(e instanceof Error ? e.message : String(e)))}
        />
      </View>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </View>
  );

  const pad = { paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: insets.bottom + 24 };

  if (kind === "image" && api) {
    return (
      <View style={[{ flex: 1, backgroundColor: colors.bg }, pad]}>
        {header}
        <Image
          source={{ uri: api.attachmentUrl(a.id), headers: mediaHeaders() }}
          cachePolicy="disk"
          contentFit="contain"
          style={{ width: width - 40, height: height - insets.top - insets.bottom - 180 }}
          accessibilityLabel={a.name}
        />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[pad, { maxWidth: 720, width: "100%", alignSelf: "center" }]}
      ListHeaderComponent={header}
      ListEmptyComponent={!error ? <Text variant="muted">Loading…</Text> : null}
      data={lines ?? []}
      keyExtractor={(_, i) => String(i)}
      initialNumToRender={40}
      windowSize={11}
      renderItem={({ item }) => (
        <Text selectable style={{ fontSize, lineHeight: Math.round(fontSize * 1.5), minHeight: item ? undefined : Math.round(fontSize * 0.75), paddingBottom: 4 }}>
          {item}
        </Text>
      )}
    />
  );
}
