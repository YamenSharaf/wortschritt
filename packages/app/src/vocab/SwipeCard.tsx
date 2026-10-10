import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, Extrapolation, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { BlurTargetView, BlurView } from "expo-blur";
import { font, useTheme } from "@/lib/theme";
import { Text } from "@/ui/Text";

/** A swipe this far (dp) or this fast (dp/s) sends the card away. */
const THRESHOLD = 110;
const FLING = 900;

export type SwipeCardHandle = { fling(known: boolean): void };

/**
 * A flashcard on frosted glass: tap to flip it over (a 3D turn), swipe right
 * for "know" and left for "don't know" (it tilts and tints as it goes), or
 * fling it with the buttons. Mounted afresh for each card (keyed by the
 * caller), so it starts centred and settles in.
 */
export const SwipeCard = forwardRef<
  SwipeCardHandle,
  {
    front: ReactNode;
    back: ReactNode;
    flipped: boolean;
    onFlip: () => void;
    onGrade: (known: boolean) => void;
    onDrag?: () => void;
  }
>(function SwipeCard({ front, back, flipped, onFlip, onGrade, onDrag }, ref) {
  const { width } = useWindowDimensions();
  const { colors, radii, scheme } = useTheme();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const turn = useSharedValue(flipped ? 1 : 0);
  const enter = useSharedValue(0);
  const done = useRef(false);

  useEffect(() => {
    enter.value = withSpring(1, { damping: 16, stiffness: 180 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    turn.value = withTiming(flipped ? 1 : 0, { duration: 320 });
  }, [flipped]); // eslint-disable-line react-hooks/exhaustive-deps

  const grade = (known: boolean) => {
    if (done.current) return;
    done.current = true;
    onGrade(known);
  };
  const flingTo = (known: boolean) => {
    "worklet";
    x.value = withTiming((known ? 1 : -1) * width * 1.4, { duration: 240 }, (finished) => {
      if (finished) scheduleOnRN(grade, known);
    });
  };
  useImperativeHandle(ref, () => ({ fling: (known) => flingTo(known) }));

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-20, 20])
    .onStart(() => {
      if (onDrag) scheduleOnRN(onDrag);
    })
    .onUpdate((e) => {
      x.value = e.translationX;
      y.value = e.translationY * 0.25;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > THRESHOLD || Math.abs(e.velocityX) > FLING) flingTo(e.translationX > 0);
      else {
        x.value = withSpring(0, { damping: 18, stiffness: 220 });
        y.value = withSpring(0);
      }
    });

  const card = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { rotate: `${interpolate(x.value, [-width, width], [-14, 14])}deg` },
      { perspective: 900 },
      // A flip: up to edge-on (90°), then the other face comes round from -90°.
      {
        rotateY: `${turn.value < 0.5 ? turn.value * 180 : (turn.value - 1) * 180}deg`,
      },
      { scale: interpolate(enter.value, [0, 1], [0.94, 1]) },
    ],
    opacity: interpolate(enter.value, [0, 1], [0.4, 1]),
  }));
  const frontFace = useAnimatedStyle(() => ({
    opacity: turn.value < 0.5 ? 1 : 0,
  }));
  const backFace = useAnimatedStyle(() => ({
    opacity: turn.value < 0.5 ? 0 : 1,
  }));
  const knowTint = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, THRESHOLD], [0, 0.85], Extrapolation.CLAMP),
  }));
  const againTint = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-THRESHOLD, 0], [0.85, 0], Extrapolation.CLAMP),
  }));

  const glassEdge = scheme === "dark" ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.7)";
  const glassFill = scheme === "dark" ? "rgba(30,41,59,0.35)" : "rgba(255,255,255,0.45)";

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1, minHeight: 260, borderRadius: radii.panel }, card]}>
        <View style={[StyleSheet.absoluteFill, { borderRadius: radii.panel, overflow: "hidden" }]}>
          <BlurView
            blurTarget={backdropRef}
            intensity={55}
            tint={scheme === "dark" ? "dark" : "light"}
            blurMethod="dimezisBlurViewSdk31Plus"
            style={[StyleSheet.absoluteFill, { backgroundColor: glassFill }]}
          />
        </View>
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radii.panel,
              borderWidth: 1,
              borderColor: glassEdge,
            },
          ]}
        />
        {/* The face that's up takes the room; the other lies over it, hidden. */}
        {/* A tap flips it (a button inside, like the speaker, keeps its own tap). */}
        <Pressable onPress={onFlip} accessibilityRole="button" accessibilityHint={flipped ? "Shows the front" : "Shows the answer"} style={{ flex: 1, padding: 28, justifyContent: "center" }}>
          <Animated.View pointerEvents={flipped ? "none" : "auto"} style={[flipped ? [StyleSheet.absoluteFill, { padding: 28, justifyContent: "center" }] : null, frontFace]}>
            {front}
          </Animated.View>
          <Animated.View pointerEvents={flipped ? "auto" : "none"} style={[flipped ? null : [StyleSheet.absoluteFill, { padding: 28, justifyContent: "center" }], backFace]}>
            {back}
          </Animated.View>
        </Pressable>
        <Stamp style={knowTint} color={colors.success} label="Know" side="left" />
        <Stamp style={againTint} color={colors.danger} label="Again" side="right" />
      </Animated.View>
    </GestureDetector>
  );
});

function Stamp({ style, color, label, side }: { style: object; color: string; label: string; side: "left" | "right" }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          bottom: 24,
          [side]: 24,
          paddingHorizontal: 12,
          paddingVertical: 4,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: color,
          transform: [{ rotate: side === "left" ? "-10deg" : "10deg" }],
        },
        style,
      ]}
    >
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: 18,
          letterSpacing: 1,
          color,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

/** What the glass blurs: a few soft colour fields behind the card (Android blurs only what's in here). */
const backdropRef: { current: View | null } = { current: null };

export function GlassBackdrop() {
  const { colors, scheme } = useTheme();
  const a = scheme === "dark" ? 0.5 : 0.42;
  const blob = (c: string, st: object) => <View style={[{ position: "absolute", width: 320, height: 320, borderRadius: 160, backgroundColor: c, opacity: a }, st]} />;
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]} pointerEvents="none">
      <BlurTargetView ref={backdropRef} style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
        {blob(colors.brand, { top: 60, left: -120 })}
        {blob(colors.reward2, { top: 300, right: -130 })}
        {blob(colors.success, { top: 560, left: -20, width: 260, height: 260 })}
      </BlurTargetView>
      {/* The colour fields themselves are soft: the whole backdrop is blurred too. */}
      <BlurView blurTarget={backdropRef} intensity={90} tint={scheme === "dark" ? "dark" : "light"} blurMethod="dimezisBlurViewSdk31Plus" style={StyleSheet.absoluteFill} />
    </View>
  );
}
