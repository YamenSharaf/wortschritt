import { Tabs } from "expo-router";
import { useTheme } from "@/lib/theme";
import { Dock } from "@/ui/Dock";

/** The sections, switched with the dock. */
export default function TabsLayout() {
  const { colors, motion } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <Dock {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
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
