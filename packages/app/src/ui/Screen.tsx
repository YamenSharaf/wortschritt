import { useRef, type ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout } from "@/lib/layout";
import { useListening } from "@/lib/listening";
import { useTheme } from "@/lib/theme";
import { MINI_PLAYER_SPACE } from "./MiniPlayer";

/** A page: the page ground, safe areas, room for the dock, optional pull-to-refresh. */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  dock = true,
  transparent = false,
  onNearEnd,
  maxWidth,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Leave room for the dock at the bottom. */
  dock?: boolean;
  /** No page ground (something is drawn behind it). */
  transparent?: boolean;
  /** Called when scrolled to within a screen of the end (to show more of something long). */
  onNearEnd?: () => void;
  /** Widest the content gets (720, or 1080 on a tablet in landscape). */
  maxWidth?: number;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const viewport = useRef(0);
  // The mini-player sits over the dock while a story plays: room for it too.
  const playing = useListening().state.phase !== "idle";
  // Beside the rail (tablet in landscape) there's no dock below, only the mini-player.
  const { wide } = useLayout();
  const bottom = !dock ? 24 : wide ? 24 + (playing ? MINI_PLAYER_SPACE : 0) : 112 + (playing ? MINI_PLAYER_SPACE : 0);
  return (
    <View style={{ flex: 1, backgroundColor: transparent ? "transparent" : colors.bg }}>
      <ScrollView
        // A tap on a button while the keyboard is up acts at once (not just closes the keyboard).
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={
          onNearEnd
            ? ({ nativeEvent: e }) => {
                if (e.contentOffset.y + e.layoutMeasurement.height * 2 >= e.contentSize.height) onNearEnd();
              }
            : undefined
        }
        scrollEventThrottle={onNearEnd ? 200 : undefined}
        onLayout={(e) => void (viewport.current = e.nativeEvent.layout.height)}
        // Too little to scroll yet: ask for more straight away.
        onContentSizeChange={onNearEnd ? (_w, h) => viewport.current > 0 && h < viewport.current * 2 && onNearEnd() : undefined}
        contentContainerStyle={{
          paddingTop: insets.top + (wide ? 28 : 16),
          paddingBottom: insets.bottom + bottom,
          paddingHorizontal: wide ? 32 : 20,
          gap: 16,
          maxWidth: maxWidth ?? (wide && dock ? 1080 : 720),
          width: "100%",
          alignSelf: "center",
        }}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.inkSubtle} /> : undefined
        }
      >
        {children}
      </ScrollView>
    </View>
  );
}
