import { Alert, Pressable, View } from "react-native";
import { Check, Download, Pause, Play, SkipBack, SkipForward, X } from "lucide-react-native";
import { audioProgressText } from "@mdb/client";
import type { ListeningController, ListeningState } from "@/lib/listening";
import { font } from "@/lib/theme";
import { Icon } from "@/ui/icons";
import { Text } from "@/ui/Text";
import type { ReaderColors } from "./style";

const fail = (e: unknown) => Alert.alert("Couldn't download the audio", e instanceof Error ? e.message : String(e));

/** Listening to this story: preparing, then play/pause, paragraph back/forward, download, stop. */
export function ListenBar({
  state,
  controller,
  story,
  paragraphs,
  colors,
  bottom,
}: {
  state: ListeningState;
  controller: ListeningController;
  story: { id: string; title: string; book: string | null };
  paragraphs: number;
  colors: ReaderColors;
  bottom: number;
}) {
  const playing = state.phase === "playing";
  const downloaded = state.downloaded.includes(story.id);
  const button = (icon: Parameters<typeof Icon>[0]["icon"], a11y: string, onPress: () => void, size = 22) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} hitSlop={6} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Icon icon={icon} size={size} color={colors.fg} />
    </Pressable>
  );
  return (
    <View
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: bottom + 8,
        minHeight: 56,
        borderRadius: 16,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.rule,
        boxShadow: colors.eink ? undefined : "0 4px 16px rgba(0,0,0,0.12)",
      }}
    >
      {state.phase === "preparing" || state.phase === "error" ? (
        <Text numberOfLines={2} style={{ flex: 1, paddingHorizontal: 8, fontFamily: font.medium, color: state.phase === "error" ? colors.vocab : colors.muted }}>
          {state.phase === "error"
            ? `Couldn't play: ${state.error}`
            : audioProgressText(state.progress)}
        </Text>
      ) : (
        <>
          {button(SkipBack, "Previous paragraph", () => controller.seekParagraph(Math.max(0, state.paragraph - 1)))}
          {button(playing ? Pause : Play, playing ? "Pause" : "Play", () => (playing ? controller.pause() : controller.resume()), 26)}
          {button(SkipForward, "Next paragraph", () => controller.seekParagraph(Math.min(paragraphs - 1, state.paragraph + 1)))}
          <View style={{ flex: 1 }} />
          {downloaded
            ? button(Check, "Downloaded for listening offline. Tap to remove the download", () =>
                Alert.alert("Remove the download?", "You can listen again online; it downloads again then.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => controller.removeDownload(story.id) },
                ]),
              )
            : null}
        </>
      )}
      {button(X, "Stop listening", controller.stop)}
    </View>
  );
}

/** In the text settings: keep this story's audio for listening offline. */
export function DownloadRow({ state, controller, story, colors }: { state: ListeningState; controller: ListeningController; story: { id: string; title: string; book: string | null }; colors: { fg: string; muted: string } }) {
  const downloaded = state.downloaded.includes(story.id);
  const busy = state.downloading.includes(story.id);
  return (
    <Pressable
      onPress={() => (downloaded ? controller.removeDownload(story.id) : void controller.download(story).catch(fail))}
      disabled={busy}
      accessibilityRole="button"
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}
    >
      <Icon icon={downloaded ? Check : Download} size={20} color={colors.fg} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.medium, color: colors.fg }}>
          {busy ? "Downloading the audio…" : downloaded ? "Downloaded for listening" : "Download for listening"}
        </Text>
        <Text variant="subtle" style={{ color: colors.muted }}>
          {downloaded ? "Plays offline. Tap to remove it." : "Listen offline, with the screen off too."}
        </Text>
      </View>
    </Pressable>
  );
}
