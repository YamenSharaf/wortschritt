import { useState } from "react";
import { Alert, Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { plainText, storyParagraphs } from "@mdb/shared";
import { useApi, useAsync } from "@mdb/client/react";
import { audioProgressText, retryText } from "@mdb/client";
import { clock, RATE_CHOICES, SKIP_CHOICES, useListening, type ListeningController, type ListeningState } from "@/lib/listening";
import { useServer } from "@/lib/server";
import { font, useTheme } from "@/lib/theme";
import { Segmented, Sheet } from "@/reader/ReaderSheets";
import { READER_FONTS } from "@/reader/style";
import { Icon } from "@/ui/icons";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { BookOpen, ChevronDown, Download, Moon, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward } from "lucide-react-native";

/**
 * The player: what's playing (cover, chapter, the sentence being read), a
 * scrubber, skip back and forward (a long press changes how far), the
 * previous and next chapter, speed, a sleep timer, and "Read along" (the
 * story, highlighted as it's read).
 */
export default function PlayerScreen() {
  const api = useApi();
  const { mediaHeaders } = useServer();
  const { controller, state } = useListening();
  const { colors, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<null | "speed" | "sleep" | "back" | "forward">(null);
  const view = useAsync(() => (state.storyId ? api.story(state.storyId) : Promise.resolve(null)), [api, state.storyId]);
  const paragraphs = view.status === "ready" && view.data ? storyParagraphs(view.data.story.body) : [];
  const sentence = paragraphs[state.paragraph] ? plainText(paragraphs[state.paragraph]!) : "";

  if (!controller || !state.storyId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, paddingTop: insets.top + 24, gap: 12 }}>
        <Text variant="muted">Nothing is playing.</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={{ color: colors.brandInk, fontFamily: font.medium }}>Back</Text>
        </Pressable>
      </View>
    );
  }
  const playing = state.phase === "playing";
  const downloaded = state.downloaded.includes(state.storyId);
  const sleepLabel = !state.sleep ? "Sleep" : "chapterEnd" in state.sleep ? "Sleep · end of chapter" : `Sleep · ${Math.max(1, Math.round((state.sleep.until - Date.now()) / 60_000))} min`;

  const round = (label: string, icon: typeof Play, onPress: () => void, opts: { size?: number; disabled?: boolean; onLongPress?: () => void; caption?: string } = {}) => (
    <Pressable
      onPress={onPress}
      onLongPress={opts.onLongPress}
      disabled={opts.disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={opts.onLongPress ? "Long press to change how far it skips" : undefined}
      hitSlop={6}
      style={{ width: 56, height: 56, alignItems: "center", justifyContent: "center", opacity: opts.disabled ? 0.35 : 1 }}
    >
      <Icon icon={icon} size={opts.size ?? 24} color={colors.ink} />
      {opts.caption ? <Text style={{ fontSize: 10, fontFamily: font.medium, color: colors.inkMuted }}>{opts.caption}</Text> : null}
    </Pressable>
  );
  const pill = (label: string, onPress: () => void, icon?: typeof Play) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, flexDirection: "row", alignItems: "center", gap: 6 }}
    >
      {icon ? <Icon icon={icon} size={15} color={colors.ink} /> : null}
      <Text style={{ fontSize: 13, fontFamily: font.medium }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20, paddingHorizontal: 24, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close the player" hitSlop={10} style={{ width: 44, height: 44, justifyContent: "center" }}>
          <Icon icon={ChevronDown} size={24} color={colors.inkMuted} />
        </Pressable>
        <Text variant="eyebrow">Listening</Text>
        <Pressable
          onPress={() => (downloaded ? undefined : void controller.download({ id: state.storyId!, title: state.title, book: state.book }))}
          accessibilityRole="button"
          accessibilityLabel={downloaded ? "Downloaded for listening offline" : "Download for listening offline"}
          hitSlop={10}
          style={{ width: 44, height: 44, alignItems: "flex-end", justifyContent: "center" }}
        >
          <Icon icon={Download} size={20} color={downloaded ? colors.success : colors.inkMuted} />
        </Pressable>
      </View>

      {/* The cover takes the room the text leaves (smaller for a long paragraph, never under 96). */}
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 96, alignItems: "center" }}>
        {state.art ? (
          <Image
            source={{ uri: state.art, headers: mediaHeaders() }}
            cachePolicy="disk"
            contentFit="cover"
            style={{ height: "100%", maxHeight: 300, aspectRatio: 2 / 3, borderRadius: radii.panel, backgroundColor: colors.surfaceSunken }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={{ height: "100%", maxHeight: 300, aspectRatio: 2 / 3, borderRadius: radii.panel, backgroundColor: colors.surfaceSunken }} />
        )}
      </View>

      <View style={{ gap: 2 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 20, lineHeight: 26 }} numberOfLines={2}>
          {state.title}
        </Text>
        <Text variant="muted">{[state.book, state.chapter && `Chapter ${state.chapter.n} of ${state.chapter.total}`].filter(Boolean).join(" · ") || "Story"}</Text>
      </View>

      {state.phase === "preparing" ? (
        <Waiting state={state} controller={controller} />
      ) : state.phase === "error" ? (
        <Text style={{ color: colors.danger }}>Couldn't play: {state.error}</Text>
      ) : sentence ? (
        // The whole paragraph; when even a small cover leaves too little room, it scrolls (from its start for each new one).
        <ScrollView
          key={state.paragraph}
          style={{ flexGrow: 0, flexShrink: 1, minHeight: 72, borderRadius: radii.control + 2, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
          contentContainerStyle={{ padding: 12 }}
          accessibilityLabel="The paragraph being read"
        >
          <Text style={{ fontFamily: READER_FONTS.libron.regular, fontSize: 16, lineHeight: 24 }}>{sentence}</Text>
        </ScrollView>
      ) : null}

      {state.partial && (
        <Text variant="subtle">
          The first {state.partial.paragraphs} of {state.partial.of} paragraphs; the rest follows by itself once it's made.
        </Text>
      )}

      <Scrubber position={state.position} duration={state.duration} onSeek={controller.seekTo} />

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {round("Previous chapter", SkipBack, () => void controller.chapter("prev"), { size: 22, disabled: !state.chapter?.prev })}
        {round(`Back ${state.skipBack} seconds`, RotateCcw, () => controller.seekBy(-state.skipBack), { onLongPress: () => setSheet("back"), caption: String(state.skipBack) })}
        <Pressable
          onPress={() => (playing ? controller.pause() : controller.resume())}
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause" : "Play"}
          style={{ width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: colors.brand }}
        >
          <Icon icon={playing ? Pause : Play} size={30} color={colors.brandInk} fill={colors.brandInk} />
        </Pressable>
        {round(`Forward ${state.skipForward} seconds`, RotateCw, () => controller.seekBy(state.skipForward), { onLongPress: () => setSheet("forward"), caption: String(state.skipForward) })}
        {round("Next chapter", SkipForward, () => void controller.chapter("next"), { size: 22, disabled: !state.chapter?.next })}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 10 }}>
        {pill(`${state.rate}×`, () => setSheet("speed"))}
        {pill(sleepLabel, () => setSheet("sleep"), Moon)}
        {pill("Read along", () => router.push(`/reader/${state.storyId}`), BookOpen)}
      </View>

      {sheet === "speed" && (
        <Sheet title="Speed" onClose={() => setSheet(null)}>
          <Segmented
            value={String(state.rate)}
            options={RATE_CHOICES.map((r) => [String(r), `${r}×`] as [string, string])}
            onChange={(v) => controller.setRate(Number(v))}
          />
        </Sheet>
      )}
      {sheet === "sleep" && (
        <Sheet title="Sleep timer" onClose={() => setSheet(null)}>
          <Segmented
            value=""
            options={[["15", "15 min"], ["30", "30 min"], ["60", "60 min"], ["chapter", "End of chapter"], ["off", "Off"]]}
            onChange={(v) => {
              controller.sleepIn(v === "off" ? null : v === "chapter" ? "chapter" : Number(v));
              setSheet(null);
            }}
          />
        </Sheet>
      )}
      {(sheet === "back" || sheet === "forward") && (
        <Sheet title={sheet === "back" ? "Skip back" : "Skip forward"} onClose={() => setSheet(null)}>
          <Segmented
            value={String(sheet === "back" ? state.skipBack : state.skipForward)}
            options={SKIP_CHOICES.map((s) => [String(s), `${s} s`] as [string, string])}
            onChange={(v) => controller.setSkip(sheet, Number(v))}
          />
        </Sheet>
      )}
    </View>
  );
}

/**
 * While the audio is being made or waits for the voice's limit: why, and
 * (when some paragraphs are made) listening to those meanwhile, or trying
 * again now (saying so when the limit still holds).
 */
function Waiting({ state, controller }: { state: ListeningState; controller: ListeningController }) {
  const { colors, radii } = useTheme();
  const [tried, setTried] = useState<number | null>(null);
  const p = state.progress;
  const waiting = p?.retryAt != null;
  const ready = p?.ready ?? 0;
  const stillLimited = waiting && tried !== null && Date.now() - tried > 1500;
  return (
    <View style={{ gap: 10, padding: 12, borderRadius: radii.control + 2, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
      <Text style={{ color: waiting ? colors.warning : colors.inkMuted }}>{waiting ? `${p!.reason ?? "Waiting for the voice's limit"}.` : audioProgressText(p)}</Text>
      {waiting && (
        <Text variant="subtle">
          {p!.done} of {p!.total} parts made · it carries on by itself {retryText(p!.retryAt!)}.{stillLimited ? " Tried again just now: the limit still holds." : ""}
        </Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {ready > 0 && (
          <Button
            kind="primary"
            label={`Listen to what's ready (${ready} of ${p?.paragraphs})`}
            icon={<Icon icon={Play} size={16} />}
            onPress={() => void controller.listenPartial().catch((e) => Alert.alert("Nothing to listen to yet", e instanceof Error ? e.message : String(e)))}
          />
        )}
        {waiting && (
          <Button
            label="Try now"
            onPress={() => {
              setTried(Date.now());
              void controller.listen({ id: state.storyId!, title: state.title, book: state.book });
            }}
          />
        )}
      </View>
    </View>
  );
}

/** The time line: drag (or tap) to go somewhere; elapsed and remaining under it. */
function Scrubber({ position, duration, onSeek }: { position: number; duration: number; onSeek: (t: number) => void }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? position;
  const frac = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const at = (x: number) => Math.min(1, Math.max(0, x / width)) * duration;
  const gesture = Gesture.Exclusive(
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(2)
      .onUpdate((e) => setDrag(at(e.x)))
      .onEnd((e) => onSeek(at(e.x)))
      .onFinalize(() => setDrag(null)),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => onSeek(at(e.x))),
  );
  return (
    <View style={{ gap: 6 }}>
      <GestureDetector gesture={gesture}>
        <View
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width || 1)}
          style={{ height: 28, justifyContent: "center" }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Position"
          accessibilityValue={{ text: `${clock(shown)} of ${clock(duration)}` }}
        >
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken }}>
            <View style={{ width: `${frac * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.brand }} />
          </View>
          <View style={{ position: "absolute", left: frac * width - 8, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.ink }} />
        </View>
      </GestureDetector>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="subtle" style={{ fontFamily: font.mono }}>
          {clock(shown)}
        </Text>
        <Text variant="subtle" style={{ fontFamily: font.mono }}>
          −{clock(Math.max(0, duration - shown))}
        </Text>
      </View>
    </View>
  );
}
