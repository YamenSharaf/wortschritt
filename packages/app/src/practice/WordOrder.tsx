import { useMemo, useRef, useState, type ReactNode } from "react";
import { View, type LayoutRectangle } from "react-native";
import { Gesture, GestureDetector, type GestureUpdateEvent, type PanGestureHandlerEventPayload } from "react-native-gesture-handler";
import Animated, { LinearTransition, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { DRAG_SLOP, dropIndex, moveWord, within } from "@mdb/client";
import { useFeedback } from "@/lib/feedback";
import { font, useTheme } from "@/lib/theme";
import { Text } from "@/ui/Text";

type Drag = { token: number; width: number; height: number; to: number | null };
type Point = { x: number; y: number };

const glide = LinearTransition.duration(160);

/**
 * Sentence building with a word bank: tap a word to add it at the end (or to
 * take it out of the answer), or drag it to its place; the other words make
 * room as it moves. Dragging out of the answer puts a word back.
 */
export function WordOrder({
  tokens,
  chosen,
  onChange,
  disabled,
}: {
  tokens: string[];
  /** The answer so far: indexes into `tokens`. */
  chosen: number[];
  onChange: (order: number[]) => void;
  disabled: boolean;
}) {
  const { colors, radii } = useTheme();
  const { tick } = useFeedback();
  const [drag, setDrag] = useState<Drag | null>(null);
  const root = useRef<View>(null);
  const answer = useRef<View>(null);
  // Where things are: the answer's chips relative to the answer box (from onLayout),
  // and the root's and the answer box's place on screen (measured as a drag starts).
  const boxes = useRef(new Map<number, LayoutRectangle>());
  const sizes = useRef(new Map<string, LayoutRectangle>());
  const answerSize = useRef({ width: 0, height: 0 });
  const origin = useRef({ root: { x: 0, y: 0 }, answer: { x: 0, y: 0 } });
  const grab = useRef({ x: 0, y: 0 });
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostStyle = useAnimatedStyle(() => ({ transform: [{ translateX: ghostX.value }, { translateY: ghostY.value }, { scale: 1.05 }] }));

  const latest = useRef({ chosen, drag, onChange });
  latest.current = { chosen, drag, onChange };

  function landing(token: number, p: Point): number | null {
    const local = { x: p.x - origin.current.answer.x, y: p.y - origin.current.answer.y };
    if (!within({ x: 0, y: 0, ...answerSize.current }, local, 24)) return null;
    const others = latest.current.chosen.filter((t) => t !== token).map((t) => boxes.current.get(t));
    return dropIndex(others.filter((b): b is LayoutRectangle => !!b), local);
  }

  const actions = useRef({
    begin(token: number, key: string, e: GestureUpdateEvent<PanGestureHandlerEventPayload>) {
      const size = sizes.current.get(key) ?? { width: 80, height: 40 };
      grab.current = { x: e.x, y: e.y };
      ghostX.value = -9999;
      root.current?.measureInWindow((x, y) => {
        origin.current.root = { x, y };
        ghostX.value = e.absoluteX - x - grab.current.x;
        ghostY.value = e.absoluteY - y - grab.current.y;
      });
      answer.current?.measureInWindow((x, y) => (origin.current.answer = { x, y }));
      tick();
      setDrag({ token, width: size.width, height: size.height, to: null });
    },
    move(token: number, e: GestureUpdateEvent<PanGestureHandlerEventPayload>) {
      ghostX.value = e.absoluteX - origin.current.root.x - grab.current.x;
      ghostY.value = e.absoluteY - origin.current.root.y - grab.current.y;
      const to = landing(token, { x: e.absoluteX, y: e.absoluteY });
      const d = latest.current.drag;
      if (d && d.token === token && d.to !== to) setDrag({ ...d, to });
    },
    end(token: number) {
      const d = latest.current.drag;
      setDrag(null);
      if (!d || d.token !== token) return;
      const next = moveWord(latest.current.chosen, token, d.to);
      if (next.join(",") !== latest.current.chosen.join(",")) {
        tick();
        latest.current.onChange(next);
      }
    },
  }).current;

  const remaining = tokens.map((_, i) => i).filter((i) => !chosen.includes(i));

  const answerChip = (t: number, floating = false) => (
    <Chip
      key={`a${t}`}
      label={tokens[t]!}
      token={t}
      sizeKey={`a${t}`}
      picked
      disabled={disabled}
      actions={actions}
      floating={floating}
      onTap={() => onChange(chosen.filter((c) => c !== t))}
      onLayout={(l) => {
        if (floating) return;
        boxes.current.set(t, l);
        sizes.current.set(`a${t}`, l);
      }}
    />
  );
  // Every word stays at its place in the tree while dragged (moving it would end its
  // gesture); only the gap moves, before the word now at `to` (not counting the dragged one).
  const gap = drag && drag.to !== null && (
    <Animated.View
      key="gap"
      layout={glide}
      style={{
        width: drag.width,
        height: drag.height,
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: colors.brand,
        backgroundColor: colors.brandSoft,
        opacity: 0.6,
      }}
    />
  );
  const answerChips: ReactNode[] = [];
  let shown = 0;
  for (const t of chosen) {
    const floating = t === drag?.token;
    if (!floating && gap && shown === drag.to) answerChips.push(gap);
    answerChips.push(answerChip(t, floating));
    if (!floating) shown++;
  }
  if (gap && shown === drag.to) answerChips.push(gap);

  return (
    <View ref={root}>
      <View
        ref={answer}
        onLayout={(e) => (answerSize.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        style={{
          minHeight: 56,
          marginBottom: 12,
          padding: 8,
          borderRadius: radii.control,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: drag && drag.to !== null ? colors.brand : colors.borderControl,
          backgroundColor: colors.surfaceSunken,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {answerChips}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {remaining.map((i) => (
          <Chip
            key={`b${i}`}
            label={tokens[i]!}
            token={i}
            sizeKey={`b${i}`}
            picked={false}
            disabled={disabled}
            actions={actions}
            hidden={drag?.token === i}
            onTap={() => onChange([...chosen, i])}
            onLayout={(l) => sizes.current.set(`b${i}`, l)}
          />
        ))}
      </View>
      {drag && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: 0,
              top: 0,
              width: drag.width,
              height: drag.height,
              borderRadius: 8,
              backgroundColor: colors.surface,
              boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
            },
            ghostStyle,
          ]}
        >
          <View style={{ flex: 1, borderRadius: 8, paddingHorizontal: 12, justifyContent: "center", backgroundColor: colors.brandSoft }}>
            <Text style={{ fontFamily: font.medium, color: colors.brandInk }}>{tokens[drag.token]}</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

type Actions = {
  begin: (token: number, key: string, e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => void;
  move: (token: number, e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => void;
  end: (token: number) => void;
};

/** One word: a tap adds or removes it; a drag (after a few pixels) moves it. */
function Chip({
  label,
  token,
  sizeKey,
  picked,
  disabled,
  hidden,
  floating,
  actions,
  onTap,
  onLayout,
}: {
  label: string;
  token: number;
  sizeKey: string;
  picked: boolean;
  disabled: boolean;
  hidden?: boolean;
  /** Out of the flow and unseen (the word being dragged). */
  floating?: boolean;
  actions: Actions;
  onTap: () => void;
  onLayout?: (l: LayoutRectangle) => void;
}) {
  const { colors } = useTheme();
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(DRAG_SLOP)
      .enabled(!disabled)
      .runOnJS(true)
      .onStart((e) => actions.begin(token, sizeKey, e))
      .onUpdate((e) => actions.move(token, e))
      .onFinalize(() => actions.end(token));
    const tap = Gesture.Tap()
      .enabled(!disabled)
      .runOnJS(true)
      .onEnd((_e, ok) => ok && tapRef.current());
    return Gesture.Exclusive(pan, tap);
  }, [actions, token, sizeKey, disabled]);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        layout={floating ? undefined : glide}
        onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout) : undefined}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === "activate" && !disabled && onTap()}
        style={{
          minHeight: 40,
          paddingHorizontal: 12,
          justifyContent: "center",
          borderRadius: 8,
          borderWidth: 1,
          borderColor: picked ? "transparent" : colors.borderControl,
          backgroundColor: picked ? colors.brandSoft : colors.surface,
          opacity: hidden || floating ? 0 : 1,
          ...(floating ? { position: "absolute" as const } : null),
        }}
      >
        <Text style={{ fontFamily: picked ? font.medium : font.regular, color: picked ? colors.brandInk : colors.ink }}>{label}</Text>
      </Animated.View>
    </GestureDetector>
  );
}
