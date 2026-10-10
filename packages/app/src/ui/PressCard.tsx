import type { ReactNode } from "react";
import { Pressable, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useTheme } from "@/lib/theme";
import { Card } from "./Card";

/** A card you tap to open something: it gives a little under the finger and springs back (not on e-ink or with reduced motion). */
export function PressCard({ onPress, children, style, a11y }: { onPress: () => void; children: ReactNode; style?: ViewStyle; a11y?: string }) {
  const { colors, motion } = useTheme();
  const scale = useSharedValue(1);
  const springy = motion.base > 0;
  const press = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={press}>
      <Pressable
        onPress={onPress}
        onPressIn={() => springy && (scale.value = withSpring(0.98, { damping: 15, stiffness: 400 }))}
        onPressOut={() => springy && (scale.value = withSpring(1, { damping: 12, stiffness: 300 }))}
        accessibilityRole="button"
        accessibilityLabel={a11y}
      >
        {({ pressed }) => <Card style={{ ...style, backgroundColor: pressed ? colors.surfaceSunken : colors.surface }}>{children}</Card>}
      </Pressable>
    </Animated.View>
  );
}
