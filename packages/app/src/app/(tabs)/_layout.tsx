import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RAIL_WIDTH, useLayout } from "@/lib/layout";
import { useTheme } from "@/lib/theme";
import { Dock } from "@/ui/Dock";

/** The sections, switched with the dock (or, on a tablet in landscape, the side rail). */
export default function TabsLayout() {
  const { colors, motion } = useTheme();
  const { wide } = useLayout();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      tabBar={(props) => <Dock {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg, paddingLeft: wide ? insets.left + RAIL_WIDTH : 0 },
        animation: motion.base === 0 ? "none" : "fade",
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="practice" />
      <Tabs.Screen name="sheets" />
      <Tabs.Screen name="stories" />
      <Tabs.Screen name="vocab" />
      <Tabs.Screen name="notes" />
    </Tabs>
  );
}
