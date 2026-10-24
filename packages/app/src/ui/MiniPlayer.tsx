import { ActivityIndicator, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { audioProgressText } from "@mdb/client";
import { clock, useListening } from "@/lib/listening";
import { useServer } from "@/lib/server";
import { font, useTheme } from "@/lib/theme";
import { Icon } from "./icons";
import { Text } from "./Text";
import { Pause, Play, RotateCcw } from "lucide-react-native";

/** Height the mini-player takes above the dock (pages leave room for it while it shows). */
export const MINI_PLAYER_SPACE = 76;

/** What's playing, above the dock on every page: skip back, play/pause; a tap opens the player. */
export function MiniPlayer() {
  const { controller, state } = useListening();
  const { mediaHeaders } = useServer();
  const { colors, radii, elevation } = useTheme();
  if (!controller || !state.storyId || state.phase === "idle") return null;
  const playing = state.phase === "playing";
  const frac = state.duration > 0 ? Math.min(1, state.position / state.duration) : 0;
  const detail =
    state.phase === "preparing"
      ? audioProgressText(state.progress)
      : state.phase === "error"
        ? `Couldn't play: ${state.error}`
        : [state.book, `${clock(Math.max(0, state.duration - state.position))} left`].filter(Boolean).join(" · ");
  return (
    <View
      style={{
        width: "100%",
        maxWidth: 560,
        paddingHorizontal: 12,
        marginBottom: 8,
      }}
    >
      <View
        style={{
          height: 64,
          borderRadius: radii.card + 2,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          backgroundColor: colors.surfaceRaised,
          boxShadow: elevation.pop === "none" ? undefined : `0 10px 30px ${colors.dockShadow}`,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 10,
          paddingRight: 6,
          overflow: "hidden",
        }}
      >
        <Pressable
          onPress={() => router.push("/player")}
          accessibilityRole="button"
          accessibilityLabel={`${state.title}, open the player`}
          style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch" }}
        >
          {state.art ? (
            <Image source={{ uri: state.art, headers: mediaHeaders() }} cachePolicy="disk" contentFit="cover" style={{ width: 34, height: 48, borderRadius: 6 }} />
          ) : (
            <View style={{ width: 34, height: 48, borderRadius: 6, backgroundColor: colors.surfaceSunken }} />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14 }}>
              {state.title}
            </Text>
            <Text numberOfLines={1} variant="subtle" style={{ fontSize: 12, color: state.phase === "error" ? colors.danger : colors.inkMuted }}>
              {detail}
            </Text>
          </View>
        </Pressable>
        {state.phase === "preparing" ? (
          <ActivityIndicator color={colors.inkSubtle} style={{ width: 44 }} />
        ) : (
          <>
            <Pressable
              onPress={() => controller.seekBy(-state.skipBack)}
              accessibilityRole="button"
              accessibilityLabel={`Back ${state.skipBack} seconds`}
              hitSlop={4}
              style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
            >
              <Icon icon={RotateCcw} size={20} color={colors.ink} />
            </Pressable>
            <Pressable
              onPress={() => (playing ? controller.pause() : controller.resume())}
              accessibilityRole="button"
              accessibilityLabel={playing ? "Pause" : "Play"}
              style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: colors.brand }}
            >
              <Icon icon={playing ? Pause : Play} size={18} color={colors.brandInk} fill={colors.brandInk} />
            </Pressable>
          </>
        )}
        <View style={{ position: "absolute", left: 0, bottom: 0, height: 2, width: `${frac * 100}%`, backgroundColor: colors.brand }} />
      </View>
    </View>
  );
}
