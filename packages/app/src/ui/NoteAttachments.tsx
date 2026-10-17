import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import type { NoteAttachment } from "@mdb/shared";
import { attachmentKind, formatBytes } from "@mdb/client";
import { openAttachment } from "@/lib/attachmentFiles";
import { useServer } from "@/lib/server";
import { font, useTheme } from "@/lib/theme";
import { Card } from "./Card";
import { Icon } from "./icons";
import { Text } from "./Text";
import { File as FileGeneric, FileAudio, FileImage, FileText, type LucideIcon } from "lucide-react-native";

const KIND_ICON: Record<ReturnType<typeof attachmentKind>, LucideIcon> = {
  text: FileText,
  image: FileImage,
  audio: FileAudio,
  pdf: FileText,
  file: FileGeneric,
};

/** Files kept with a note. Text and images open here; anything else in the app for its type. */
export function NoteAttachments({ attachments, onRemove }: { attachments: NoteAttachment[]; onRemove: (id: string) => void }) {
  if (attachments.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="muted" style={{ fontFamily: font.medium, fontSize: 14 }}>{`Attachments · ${attachments.length}`}</Text>
      <Card>
        {attachments.map((a, i) => (
          <AttachmentRow key={a.id} attachment={a} first={i === 0} onRemove={() => onRemove(a.id)} />
        ))}
      </Card>
    </View>
  );
}

/** Where a tap on an attachment goes: the viewer for text and images. */
export function showsInApp(a: NoteAttachment) {
  const kind = attachmentKind(a.type);
  return kind === "text" || kind === "image";
}

function AttachmentRow({ attachment: a, first, onRemove }: { attachment: NoteAttachment; first: boolean; onRemove: () => void }) {
  const { colors, radii } = useTheme();
  const { api, mediaHeaders } = useServer();
  const [opening, setOpening] = useState(false);
  const kind = attachmentKind(a.type);

  async function openOutside() {
    if (!api) return;
    setOpening(true);
    try {
      await openAttachment(api, mediaHeaders(), a);
    } catch (e) {
      Alert.alert(`Couldn't open "${a.name}"`, e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }

  function open() {
    if (showsInApp(a)) {
      router.push({ pathname: "/attachment/[id]", params: { id: a.id, name: a.name, type: a.type, size: String(a.size), createdAt: String(a.createdAt) } });
    } else void openOutside();
  }

  function menu() {
    Alert.alert(a.name, formatBytes(a.size), [
      { text: "Open with…", onPress: () => void openOutside() },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          Alert.alert(`Delete "${a.name}"?`, "This can't be undone.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: onRemove },
          ]),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <Pressable
      onPress={open}
      onLongPress={menu}
      accessibilityRole="button"
      accessibilityLabel={`${a.name}, ${formatBytes(a.size)}`}
      accessibilityHint="Opens it. Long press for more."
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSunken : "transparent",
      })}
    >
      {kind === "image" && api ? (
        <Image
          source={{ uri: api.attachmentUrl(a.id), headers: mediaHeaders() }}
          cachePolicy="disk"
          contentFit="cover"
          style={{ width: 40, height: 40, borderRadius: radii.control, borderWidth: 1, borderColor: colors.border }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={{ width: 40, height: 40, borderRadius: radii.control, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSunken }}>
          <Icon icon={KIND_ICON[kind]} size={20} color={colors.inkMuted} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.medium }}>
          {a.name}
        </Text>
        <Text variant="subtle">{`${formatBytes(a.size)} · ${new Date(a.createdAt * 1000).toLocaleDateString()}`}</Text>
      </View>
      {opening && <ActivityIndicator color={colors.inkSubtle} />}
    </Pressable>
  );
}
