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
import type { ComposeReaderProps } from "../../modules/reader";
import { tokens } from "./text";

type Props = Omit<ComposeReaderProps, "onWordPress" | "onPageChange" | "onCenterTap"> & {
  onWord: (word: string, paragraph: number) => void;
  onPage: (page: number, count: number) => void;
  onCenter: () => void;
  /** How long laying out the pages took (ms), for the comparison. */
  onLaidOut?: (ms: number) => void;
};

type Block = { index: number; text: string; style: TextStyle; gap: number };
type Line = { text: string; height: number };
type Segment = { block: Block; text: string; endsBlock: boolean };

const H_PAD = 24;
const V_PAD = 28;

/**
 * Engine A of the reader spike: React Native text. The same look and
 * behaviour as the Compose engine (modules/reader): words tappable anywhere,
 * pages packed from React Native's own line measurements (onTextLayout),
 * outer quarters and swipes turn the page at once, the middle is the app's.
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

function PagedRNReader(p: Props & { blocks: Block[] }) {
  const { width: screenWidth } = useWindowDimensions();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [lines, setLines] = useState<Record<number, Line[]>>({});
  const [page, setPage] = useState(0);
  const started = useRef(0);
  const swipeFrom = useRef<number | null>(null);
  const swiped = useRef(false);

  // A new layout (text, size or style changed): measure again.
  const layoutKey = `${size?.w}x${size?.h}|${p.blocks.map((b) => b.text.length).join(",")}|${p.fontSize}|${p.lineHeight}|${p.serif}`;
  useEffect(() => {
    setLines({});
    setPage(0);
    started.current = Date.now();
  }, [layoutKey]);

  const measured = Object.keys(lines).length === p.blocks.length;
  const pages = useMemo(() => (size && measured ? paginate(p.blocks, lines, size.h - V_PAD * 2) : []), [measured, lines, size, p.blocks]);
  const onLaidOut = p.onLaidOut;
  useEffect(() => {
    if (pages.length) onLaidOut?.(Date.now() - started.current);
  }, [pages, onLaidOut]);
  const onPage = p.onPage;
  useEffect(() => {
    if (pages.length) onPage(page, pages.length);
  }, [page, pages.length, onPage]);

  const turn = useCallback((d: number) => setPage((x) => Math.max(0, Math.min(pages.length - 1, x + d))), [pages.length]);
  const tapAt = (x: number) => (x < screenWidth * 0.25 ? turn(-1) : x > screenWidth * 0.75 ? turn(1) : p.onCenter());

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
        <Pressable
          style={{ flex: 1, paddingHorizontal: H_PAD, paddingVertical: V_PAD }}
          onPressIn={(e) => {
            swipeFrom.current = e.nativeEvent.pageX;
            swiped.current = false;
          }}
          onPressOut={(e) => {
            const dx = swipeFrom.current === null ? 0 : e.nativeEvent.pageX - swipeFrom.current;
            if (Math.abs(dx) > 60) {
              swiped.current = true;
              turn(dx < 0 ? 1 : -1);
            }
          }}
          onPress={(e) => {
            if (!swiped.current) tapAt(e.nativeEvent.pageX);
          }}
        >
          {pages[Math.min(page, pages.length - 1)]!.map((s, i) => (
            <View key={i} style={{ marginBottom: s.endsBlock ? s.block.gap : 0 }}>
              <WordText text={s.text} style={s.block.style} onWord={(w) => p.onWord(w, s.block.index)} />
            </View>
          ))}
        </Pressable>
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
