import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

/** A page: the page ground, safe areas, room for the dock, optional pull-to-refresh. */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  dock = true,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Leave room for the dock at the bottom. */
  dock?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        // A tap on a button while the keyboard is up acts at once (not just closes the keyboard).
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
