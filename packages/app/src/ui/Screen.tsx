import { useRef, type ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

/** A page: the page ground, safe areas, room for the dock, optional pull-to-refresh. */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  dock = true,
  transparent = false,
  onNearEnd,
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
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const viewport = useRef(0);
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
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + (dock ? 112 : 24),
          paddingHorizontal: 20,
          gap: 16,
          maxWidth: 720,
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
