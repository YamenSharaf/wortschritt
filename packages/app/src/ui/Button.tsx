import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type GestureResponderEvent, type PressableProps } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useFeedback } from "@/lib/feedback";
import { font, useTheme } from "@/lib/theme";
import { tint } from "./color";
import { Text } from "./Text";

type Kind = "primary" | "secondary" | "ghost";

/**
 * A button: primary is glass (a tint of the brand colour with a glossy top
 * edge and a soft glow; on e-ink a solid, outlined one, from the effect
 * tokens), secondary is outlined, ghost is bare. It gives a little under the
 * finger and springs back (not on e-ink or with reduced motion); a primary
 * one also gives a light tap.
 */
export function Button({
  kind = "secondary",
  label,
  icon,
  busy,
  disabled,
  onPressIn,
  onPressOut,
  onPress,
  ...props
}: PressableProps & { kind?: Kind; label: string; icon?: ReactNode; busy?: boolean }) {
  const { colors, effects, radii, elevation, motion } = useTheme();
  const feedback = useFeedback();
  const off = disabled || busy;
  const flat = elevation.glass === "none";
  const scale = useSharedValue(1);
  const press = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const springy = motion.base > 0;
  return (
    <Animated.View style={press}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!off, busy: !!busy }}
        disabled={off}
        {...props}
        onPressIn={(e: GestureResponderEvent) => {
          if (springy) scale.value = withSpring(0.96, { damping: 15, stiffness: 400 });
          onPressIn?.(e);
        }}
        onPressOut={(e: GestureResponderEvent) => {
          if (springy) scale.value = withSpring(1, { damping: 12, stiffness: 300 });
          onPressOut?.(e);
        }}
        onPress={(e: GestureResponderEvent) => {
          if (kind === "primary") feedback.tick();
          onPress?.(e);
        }}
        style={({ pressed }) => [
          {
            minHeight: 44,
            paddingHorizontal: 16,
            borderRadius: radii.control,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            opacity: off ? 0.45 : 1,
          },
          kind === "primary" && {
            backgroundColor: tint(colors.brand, pressed ? effects.glassFillHover : effects.glassFill),
            borderWidth: 1,
            borderColor: tint(colors.brand, effects.glassBorder),
            // Glass: a light top edge inside, a soft glow of the brand colour under it.
            boxShadow: flat ? undefined : `inset 0 1px 0 #ffffff59, 0 4px 14px ${tint(colors.brand, pressed ? 18 : 26)}`,
          },
          kind === "secondary" && {
            backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
            borderWidth: 1,
            borderColor: colors.borderControl,
            boxShadow: flat ? undefined : elevation.card,
          },
          kind === "ghost" && { backgroundColor: pressed ? colors.surfaceSunken : "transparent" },
        ]}
      >
        {busy ? <ActivityIndicator color={colors.brandInk} /> : icon ? <View>{icon}</View> : null}
        <Text
          style={{
            fontFamily: kind === "primary" ? font.semibold : font.medium,
            fontSize: 15,
            color: kind === "primary" ? colors.brandInk : kind === "ghost" ? colors.inkMuted : colors.ink,
          }}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
