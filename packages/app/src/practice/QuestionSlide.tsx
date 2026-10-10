import { useEffect, type ReactNode } from "react";
import { useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { SlideInLeft, SlideInRight, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

/** A swipe this far (dp) or this fast (dp/s) goes to the next or previous question. */
const THRESHOLD = 80;
const FLING = 700;

/**
 * One question that can be swiped away: left for the next, right for the
 * previous. It follows the finger, slides in from the side it came from,
 * pops on a right answer and shakes on a wrong one. Without motion (e-ink,
 * reduced motion) it's a plain container and swipes still work.
 */
export function QuestionSlide({
  dir,
  verdict,
  animated,
  canPrev,
  canNext,
  onPrev,
  onNext,
  children,
}: {
  /** Where it comes from: 1 = the next one (slides in from the right), -1 = the previous. Mount one per question (key it). */
  dir: 1 | -1;
  /** The answer's verdict once given (null before). */
  verdict: boolean | null;
  animated: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  const scale = useSharedValue(1);

  // Pop on right, shake on wrong.
  useEffect(() => {
    if (!animated || verdict === null) return;
    if (verdict) scale.value = withSequence(withTiming(1.035, { duration: 120 }), withSpring(1, { damping: 10, stiffness: 260 }));
    else x.value = withSequence(...[-10, 10, -8, 8, -4, 0].map((v) => withTiming(v, { duration: 45 })));
  }, [verdict]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next: boolean) => (next ? onNext() : onPrev());
  const pan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      if (!animated) return;
      // Resist at the ends.
      const blocked = (e.translationX < 0 && !canNext) || (e.translationX > 0 && !canPrev);
      x.value = blocked ? e.translationX * 0.2 : e.translationX;
    })
    .onEnd((e) => {
      const far = Math.abs(e.translationX) > THRESHOLD || Math.abs(e.velocityX) > FLING;
      const next = e.translationX < 0;
      if (far && (next ? canNext : canPrev)) {
        if (animated) x.value = withTiming((next ? -1 : 1) * width, { duration: 160 }, () => scheduleOnRN(go, next));
        else scheduleOnRN(go, next);
      } else if (animated) x.value = withSpring(0, { damping: 18, stiffness: 220 });
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { scale: scale.value }],
  }));
  const entering = animated ? (dir > 0 ? SlideInRight : SlideInLeft).duration(220) : undefined;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View entering={entering} style={style}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
