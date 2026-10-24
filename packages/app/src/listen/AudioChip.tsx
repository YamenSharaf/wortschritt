import { useState } from "react";
import { Alert, Pressable } from "react-native";
import { router } from "expo-router";
import type { StoryAudioBrief } from "@mdb/shared";
import { useApi } from "@mdb/client/react";
import { clock, useListening, type StoryRef } from "@/lib/listening";
import { font, useTheme } from "@/lib/theme";
import { Icon } from "@/ui/icons";
import { Text } from "@/ui/Text";
import { AlertCircle, Clock, Headphones, Play } from "lucide-react-native";

/**
 * A story's audio, as one small control: "Generate audiobook" (asked for on
 * purpose), "Making it · 12 of 40", "Waiting · 34 of 80" (the voice's
 * limit), then "Play · 12 min" or "Resume · 6 min left" (which opens the
 * player). Shows nothing when stories can't be listened to here.
 */
export function AudioChip({ story, audio, onGenerated }: { story: StoryRef; audio: StoryAudioBrief | undefined; onGenerated: () => void }) {
  const api = useApi();
  const { controller, state } = useListening();
  const { colors } = useTheme();
  const [asking, setAsking] = useState(false);
  const downloaded = state.downloaded.includes(story.id);
  if (!controller || (!state.enabled && !downloaded)) return null;

  const saved = state.positions[story.id];
  const here = state.storyId === story.id && state.phase !== "idle";
  const ready = downloaded || audio?.state === "ready";
  const play = () => {
    if (!here) void controller.listen(story);
    router.push("/player");
  };
  const generate = async () => {
    setAsking(true);
    try {
      await api.startStoryAudio(story.id);
      onGenerated();
    } catch (e) {
      Alert.alert("Couldn't generate the audiobook", e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  let label: string;
  let tone: "brand" | "muted" | "warning" | "danger" = "brand";
  let icon = Play;
  let onPress: (() => void) | null = play;
  if (here) label = state.phase === "playing" ? "Playing" : "Paused";
  else if (ready) {
    const left = saved && !saved.done && saved.t > 5 ? saved.duration - saved.t : null;
    label = left !== null ? `Resume · ${clock(left)} left` : `Play · ${Math.max(1, Math.round((audio?.duration ?? saved?.duration ?? 60) / 60))} min`;
  } else if (audio?.state === "building") {
    label = audio.total ? `Making the audio · ${audio.done} of ${audio.total}` : "Making the audio…";
    tone = "muted";
    icon = Clock;
    onPress = null;
  } else if (audio?.state === "waiting") {
    label = `Waiting · ${audio.done} of ${audio.total}`;
    tone = "warning";
    icon = Clock;
    onPress = () =>
      Alert.alert("Waiting for the voice's limit", "The audio carries on by itself when the voice can be used again. Try now?", [
        { text: "Later", style: "cancel" },
        { text: "Try now", onPress: () => void generate() },
      ]);
  } else if (audio?.state === "error") {
    label = "Couldn't make it · Try again";
    tone = "danger";
    icon = AlertCircle;
    onPress = () => void generate();
  } else {
    label = asking ? "Asking…" : "Generate audiobook";
    tone = "muted";
    icon = Headphones;
    onPress = asking ? null : () => void generate();
  }

  const fg = { brand: colors.brandInk, muted: colors.inkMuted, warning: colors.warning, danger: colors.danger }[tone];
  const bg = { brand: colors.brandSoft, muted: "transparent", warning: colors.warningSoft, danger: colors.dangerSoft }[tone];
  return (
    <Pressable
      onPress={onPress ?? undefined}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${story.title}`}
      hitSlop={4}
      style={{
        alignSelf: "flex-start",
        minHeight: 32,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: tone === "muted" ? colors.borderStrong : "transparent",
        backgroundColor: bg,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Icon icon={icon} size={13} color={fg} fill={icon === Play ? fg : undefined} />
      <Text style={{ fontSize: 13, fontFamily: font.medium, color: fg }}>{label}</Text>
    </Pressable>
  );
}
