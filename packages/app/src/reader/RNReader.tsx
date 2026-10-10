import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
  type TextStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { tokens } from "./text";

type Props = {
  storyTitle: string;
  /** Plain paragraphs (plainParagraphs). */
  paragraphs: string[];
  mode: "pages" | "scroll";
  fontSize: number;
  /** A multiple of the font size. */
  lineHeight: number;
  serif: boolean;
  textColor: string;
  pageColor: string;
  onWord: (word: string, paragraph: number) => void;
  onPage: (page: number, count: number) => void;
  onCenter: () => void;
};

type Block = { index: number; text: string; style: TextStyle; gap: number };
type Line = { text: string; height: number };
type Segment = { block: Block; text: string; endsBlock: boolean };

const H_PAD = 24;
const V_PAD = 28;

/**
 * The reader: React Native text, as pages or one scroll. Words are tappable
 * anywhere; pages are packed from React Native's own line measurements
 * (onTextLayout); the outer quarters and swipes turn the page at once (no
 * animation, for e-ink), and the middle is the app's (its bars).
 */
export function RNReader(p: Props) {
  const blocks = useMemo<Block[]>(() => {
    const body: TextStyle = {
      color: p.textColor,
      fontSize: p.fontSize,
      lineHeight: p.fontSize * p.lineHeight,
      fontFamily: p.serif ? "serif" : "sans-serif",
    };
    const title: TextStyle = { ...body, fontSize: p.fontSize * 1.45, lineHeight: p.fontSize * 1.45 * 1.25, fontWeight: "600" };
    const gap = p.fontSize * 0.9;
    return [
      ...(p.storyTitle ? [{ index: -1, text: p.storyTitle, style: title, gap: gap * 1.2 }] : []),
      ...p.paragraphs.map((text, index) => ({ index, text, style: body, gap })),
    ];
  }, [p.storyTitle, p.paragraphs, p.textColor, p.fontSize, p.lineHeight, p.serif]);

  return p.mode === "scroll" ? (
    <ScrollView style={{ flex: 1, backgroundColor: p.pageColor }} contentContainerStyle={{ paddingHorizontal: H_PAD, paddingVertical: 32 }}>
      {blocks.map((b) => (
        <Pressable key={b.index} onPress={p.onCenter} style={{ marginBottom: b.gap }}>
          <WordText text={b.text} style={b.style} onWord={(w) => p.onWord(w, b.index)} />
        </Pressable>
      ))}
    </ScrollView>
  ) : (
    <PagedRNReader {...p} blocks={blocks} />
  );
}

function WordText({ text, style, onWord }: { text: string; style: TextStyle; onWord: (w: string) => void }) {
  return (
    <Text style={style}>
      {tokens(text).map((t, i) =>
        t.word ? (
          <Text key={i} onPress={() => onWord(t.text)} suppressHighlighting>
            {t.text}
          </Text>
        ) : (
          t.text
        ),
      )}
    </Text>
  );
}

/** A swipe this long (dp), or this fast (dp/s) in its direction, turns the page. */
const SWIPE_DISTANCE = 40;
const SWIPE_VELOCITY = 350;

function PagedRNReader(p: Props & { blocks: Block[] }) {
  const { width: screenWidth } = useWindowDimensions();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [lines, setLines] = useState<Record<number, Line[]>>({});
  const [page, setPage] = useState(0);
  const swipedAt = useRef(0);

  // A new layout (text, size or style changed): measure again.
  const layoutKey = `${size?.w}x${size?.h}|${p.blocks.map((b) => b.text.length).join(",")}|${p.fontSize}|${p.lineHeight}|${p.serif}`;
  useEffect(() => {
    setLines({});
    setPage(0);
  }, [layoutKey]);

  const measured = Object.keys(lines).length === p.blocks.length;
  const pages = useMemo(() => (size && measured ? paginate(p.blocks, lines, size.h - V_PAD * 2) : []), [measured, lines, size, p.blocks]);
  const onPage = p.onPage;
  useEffect(() => {
    if (pages.length) onPage(page, pages.length);
  }, [page, pages.length, onPage]);

  const turn = useCallback((d: number) => setPage((x) => Math.max(0, Math.min(pages.length - 1, x + d))), [pages.length]);
  const tapAt = (x: number) => (x < screenWidth * 0.25 ? turn(-1) : x > screenWidth * 0.75 ? turn(1) : p.onCenter());

  // A swipe turns the page when it's long enough or quick enough (a short
  // flick counts); a mostly vertical move doesn't. Activating cancels the
  // tap underneath, and the timestamp guards against one slipping through.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-12, 12])
        .failOffsetY([-24, 24])
        .onEnd((e) => {
          const far = Math.abs(e.translationX) > SWIPE_DISTANCE;
          const fast = Math.abs(e.velocityX) > SWIPE_VELOCITY && Math.sign(e.velocityX) === Math.sign(e.translationX);
          if (!far && !fast) return;
          swipedAt.current = Date.now();
          turn(e.translationX < 0 ? 1 : -1);
        }),
    [turn],
  );

  return (
    <View
      style={{ flex: 1, backgroundColor: p.pageColor }}
      onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size && !measured && (
        // Laid out off screen at the page's width to get each block's lines.
        <View style={{ position: "absolute", opacity: 0, left: H_PAD, width: size.w - H_PAD * 2 }} pointerEvents="none">
          {p.blocks.map((b) => (
            <Text
              key={`${layoutKey}-${b.index}`}
              style={b.style}
              onTextLayout={(e: NativeSyntheticEvent<TextLayoutEventData>) => {
                const ls = e.nativeEvent.lines.map((l) => ({ text: l.text, height: l.height }));
                setLines((cur) => ({ ...cur, [b.index]: ls }));
              }}
            >
              {b.text}
            </Text>
          ))}
        </View>
      )}
      {pages.length > 0 && (
        <GestureDetector gesture={swipe}>
          <Pressable
            style={{ flex: 1, paddingHorizontal: H_PAD, paddingVertical: V_PAD }}
            onPress={(e) => {
              if (Date.now() - swipedAt.current > 300) tapAt(e.nativeEvent.pageX);
            }}
          >
            {pages[Math.min(page, pages.length - 1)]!.map((s, i) => (
              <View key={i} style={{ marginBottom: s.endsBlock ? s.block.gap : 0 }}>
                <WordText text={s.text} style={s.block.style} onWord={(w) => p.onWord(w, s.block.index)} />
              </View>
            ))}
          </Pressable>
        </GestureDetector>
      )}
    </View>
  );
}

function paginate(blocks: Block[], lines: Record<number, Line[]>, height: number): Segment[][] {
  const pages: Segment[][] = [];
  let current: Segment[] = [];
  let used = 0;
  for (const b of blocks) {
    const ls = lines[b.index] ?? [];
    let at = 0;
    while (at < ls.length) {
      let end = at;
      let h = 0;
      while (end < ls.length && used + h + ls[end]!.height <= height) h += ls[end++]!.height;
      if (end === at) {
        if (current.length === 0) {
          h = ls[at]!.height; // taller than a page: a page of its own
          end = at + 1;
        } else {
          pages.push(current);
          current = [];
          used = 0;
          continue;
        }
      }
      current.push({ block: b, text: ls.slice(at, end).map((l) => l.text).join("").trimEnd(), endsBlock: end === ls.length });
      used += h;
      at = end;
      if (at < ls.length) {
        pages.push(current);
        current = [];
        used = 0;
      }
    }
    used += b.gap;
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}
