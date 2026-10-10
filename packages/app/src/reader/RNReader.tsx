import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
  type TextStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { Piece } from "./pieces";
import type { ReaderColors } from "./style";
import { rgbHex, sentenceAround, tokens } from "./text";

export type Typography = {
  /** Font faces for the German text and the title (see READER_FONTS). */
  regular: string;
  title: string;
  /** The app's own face, for the English lines and the header's small print. */
  ui: string;
  size: number;
  /** A multiple of `size`. */
  lineHeight: number;
  /** The text column's widest (px). */
  maxWidth: number;
};

export type ReaderControls = {
  /** Turn by `delta` pages (pages mode). */
  turn(delta: number): void;
};

type Props = {
  pieces: Piece[];
  mode: "pages" | "scroll";
  typo: Typography;
  colors: ReaderColors;
  /** Underline these (saved words), or nothing. */
  isSaved?: (word: string) => boolean;
  /** Where to open (0–1), or null for the top. */
  resumeAt: number | null;
  /** After the text: finished / read again / next chapter (its own page in pages mode). */
  ending: ReactNode;
  onWord: (word: string, context: string) => void;
  onReveal: (key: string) => void;
  /** How far the learner has seen (0–1). */
  onProgress: (fraction: number) => void;
  /** Paragraphs on screen or about to be (to translate them). */
  onVisible?: (paras: number[]) => void;
  /** A tap beside the words in the middle: show or hide the bars. */
  onCenter: () => void;
  /** Pages mode: the page and the count (page === count is the end page). */
  onPage?: (page: number, count: number) => void;
};

type Line = { text: string; height: number };
type Segment = { piece: Piece; text: string; ends: boolean };

const H_PAD = 24;
const V_PAD = 24;
/** A swipe this long (dp), or this fast (dp/s) in its direction, turns the page. */
const SWIPE_DISTANCE = 40;
const SWIPE_VELOCITY = 350;

function styleFor(piece: Piece, t: Typography, c: ReaderColors): TextStyle {
  switch (piece.kind) {
    case "eyebrow":
      return { fontFamily: t.ui, fontSize: 12, lineHeight: 18, letterSpacing: 0.8, textTransform: "uppercase", color: c.muted };
    case "title":
      return { fontFamily: t.title, fontSize: t.size * 1.45, lineHeight: t.size * 1.45 * 1.25, color: c.fg };
    case "meta":
      return { fontFamily: t.ui, fontSize: 12, lineHeight: 18, color: c.muted };
    case "en":
      return {
        fontFamily: t.ui,
        fontSize: t.size * 0.78,
        lineHeight: t.size * 0.78 * 1.45,
        // Peek: a grey bar where the line is (no blur on Android, and none wanted on e-ink).
        color: piece.hidden ? "transparent" : c.muted,
        backgroundColor: piece.hidden ? rgbHex(hexToTriplet(c.muted), 0.22) : undefined,
        opacity: piece.loading ? 0.6 : 1,
      };
    default:
      return { fontFamily: t.regular, fontSize: t.size, lineHeight: t.size * t.lineHeight, color: c.fg };
  }
}

function hexToTriplet(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** The reader's text: React Native text, paged from its own line measurements, or one scroll. */
export const RNReader = forwardRef<ReaderControls, Props>(function RNReader(p, ref) {
  return p.mode === "scroll" ? <ScrollReader {...p} /> : <PagedReader {...p} ref={ref} />;
});

/** A piece's text with each word tappable (and saved ones underlined). */
function PieceText({ piece, text, style, p }: { piece: Piece; text: string; style: TextStyle; p: Props }) {
  if (piece.kind === "en") {
    return (
      <Text style={style} onPress={piece.hidden && piece.reveal ? () => p.onReveal(piece.reveal!) : undefined} suppressHighlighting>
        {text}
      </Text>
    );
  }
  if (piece.kind !== "de" && piece.kind !== "title") return <Text style={style}>{text}</Text>;
  let at = 0;
  return (
    <Text style={style}>
      {tokens(text).map((t, i) => {
        const offset = at;
        at += t.text.length;
        if (!t.word) return t.text;
        const saved = p.isSaved?.(t.text);
        return (
          <Text
            key={i}
            onPress={() => p.onWord(t.text, sentenceAround(text, offset))}
            suppressHighlighting
            style={saved ? { textDecorationLine: "underline", textDecorationStyle: "dotted", textDecorationColor: p.colors.vocab } : undefined}
          >
            {t.text}
          </Text>
        );
      })}
    </Text>
  );
}

// --- scroll ------------------------------------------------------------------

function ScrollReader(p: Props) {
  const scroller = useRef<ScrollView>(null);
  const tops = useRef<Record<number, number>>({});
  const content = useRef(0);
  const viewport = useRef(0);
  const restored = useRef(false);
  const { onProgress, onVisible } = p;

  const report = useCallback(
    (y: number) => {
      if (!content.current) return;
      onProgress((y + viewport.current) / content.current);
      if (onVisible) {
        const lo = y - 200;
        const hi = y + viewport.current + 200;
        onVisible(Object.entries(tops.current).flatMap(([para, top]) => (top >= lo && top <= hi ? [Number(para)] : [])));
      }
    },
    [onProgress, onVisible],
  );

  return (
    <ScrollView
      ref={scroller}
      style={{ flex: 1, backgroundColor: p.colors.bg }}
      contentContainerStyle={{ paddingHorizontal: H_PAD, paddingTop: 72, paddingBottom: 64, alignItems: "center" }}
      onLayout={(e) => (viewport.current = e.nativeEvent.layout.height)}
      onContentSizeChange={(_, h) => {
        content.current = h;
        if (!restored.current && viewport.current) {
          restored.current = true;
          if (p.resumeAt !== null) scroller.current?.scrollTo({ y: Math.max(0, p.resumeAt * h - viewport.current), animated: false });
          report(0);
        }
      }}
      onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => report(e.nativeEvent.contentOffset.y)}
      scrollEventThrottle={250}
    >
      <View style={{ width: "100%", maxWidth: p.typo.maxWidth }}>
        {p.pieces.map((piece) => (
          <Pressable
            key={piece.key}
            onPress={p.onCenter}
            onLayout={(e: LayoutChangeEvent) => {
              if (piece.para >= 0 && tops.current[piece.para] === undefined) tops.current[piece.para] = e.nativeEvent.layout.y;
            }}
            style={{ marginBottom: piece.gapAfter * p.typo.size }}
          >
            <PieceText piece={piece} text={piece.text} style={styleFor(piece, p.typo, p.colors)} p={p} />
          </Pressable>
        ))}
        <View style={{ marginTop: p.typo.size }}>{p.ending}</View>
      </View>
    </ScrollView>
  );
}

// --- pages -------------------------------------------------------------------

const PagedReader = forwardRef<ReaderControls, Props>(function PagedReader(p, ref) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [lines, setLines] = useState<Record<string, Line[]>>({});
  const [page, setPage] = useState(0);
  const restored = useRef(false);
  /** The first paragraph on the page: a re-layout (size, font, English lines) keeps you on it. */
  const anchor = useRef(-1);
  const swipedAt = useRef(0);

  const width = size ? Math.min(size.w - H_PAD * 2, p.typo.maxWidth) : 0;
  const styles = useMemo(() => new Map(p.pieces.map((x) => [x.key, styleFor(x, p.typo, p.colors)])), [p.pieces, p.typo, p.colors]);
  // A new layout (text, size or type): measure again.
  const layoutKey = `${width}x${size?.h}|${p.typo.regular}|${p.typo.size}|${p.typo.lineHeight}|${p.pieces.map((x) => `${x.key}:${x.text.length}`).join(",")}`;
  useEffect(() => setLines({}), [layoutKey]);

  const measured = size !== null && p.pieces.every((x) => lines[x.key]);
  const pages = useMemo(
    () => (size && measured ? paginate(p.pieces, lines, size.h - V_PAD * 2, p.typo.size) : []),
    [measured, lines, size, p.pieces, p.typo.size],
  );
  const count = pages.length;

  // Where to be once laid out: the server's resume point the first time, then the anchor.
  useEffect(() => {
    if (!count) return;
    if (!restored.current) {
      restored.current = true;
      setPage(p.resumeAt === null ? 0 : Math.min(count - 1, Math.floor(p.resumeAt * count)));
      return;
    }
    setPage((cur) => {
      if (cur >= count) return count; // stay on the end page
      const i = pages.findIndex((pg) => pg.some((s) => s.piece.para >= anchor.current));
      return anchor.current < 0 ? 0 : Math.max(0, i);
    });
  }, [pages]); // eslint-disable-line react-hooks/exhaustive-deps

  const { onProgress, onPage, onVisible } = p;
  useEffect(() => {
    if (!count) return;
    if (page < count) anchor.current = pages[page]!.find((s) => s.piece.para >= 0)?.piece.para ?? anchor.current;
    onProgress(page / count);
    onPage?.(page, count);
    if (onVisible) onVisible([...new Set([...(pages[page] ?? []), ...(pages[page + 1] ?? [])].map((s) => s.piece.para).filter((x) => x >= 0))]);
  }, [page, count]); // eslint-disable-line react-hooks/exhaustive-deps

  const turn = useCallback((d: number) => setPage((x) => Math.max(0, Math.min(count, x + d))), [count]);
  useImperativeHandle(ref, () => ({ turn }), [turn]);

  const tapAt = (x: number) => {
    const w = size?.w ?? 0;
    if (x < w * 0.25 && page > 0) turn(-1);
    else if (x > w * 0.75 && page < count) turn(1);
    else p.onCenter();
  };

  // A swipe is long enough or quick enough (a short flick counts); a mostly
  // vertical move isn't one. It cancels the tap underneath.
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
      style={{ flex: 1, backgroundColor: p.colors.bg }}
      onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size && !measured && (
        // Laid out off screen at the column's width to get each piece's lines.
        <View style={{ position: "absolute", opacity: 0, left: H_PAD, width }} pointerEvents="none">
          {p.pieces.map((x) => (
            <Text
              key={`${layoutKey}-${x.key}`}
              style={styles.get(x.key)}
              onTextLayout={(e: NativeSyntheticEvent<TextLayoutEventData>) => {
                const ls = e.nativeEvent.lines.map((l) => ({ text: l.text, height: l.height }));
                setLines((cur) => ({ ...cur, [x.key]: ls }));
              }}
            >
              {x.text}
            </Text>
          ))}
        </View>
      )}
      {count > 0 && (
        <GestureDetector gesture={swipe}>
          <Pressable
            style={{ flex: 1, paddingHorizontal: H_PAD, paddingVertical: V_PAD, alignItems: "center" }}
            onPress={(e) => {
              if (Date.now() - swipedAt.current > 300) tapAt(e.nativeEvent.pageX);
            }}
          >
            {page < count ? (
              <View style={{ width }}>
                {pages[page]!.map((s, i) => (
                  <View key={`${s.piece.key}-${i}`} style={{ marginBottom: s.ends ? s.piece.gapAfter * p.typo.size : 0 }}>
                    <PieceText piece={s.piece} text={s.text} style={styles.get(s.piece.key)!} p={p} />
                  </View>
                ))}
              </View>
            ) : (
              <ScrollView style={{ width }} contentContainerStyle={{ paddingVertical: 16 }}>
                {p.ending}
              </ScrollView>
            )}
          </Pressable>
        </GestureDetector>
      )}
    </View>
  );
});

/** Pack the pieces' lines into pages of `height`; a piece may run onto the next page. */
function paginate(pieces: Piece[], lines: Record<string, Line[]>, height: number, size: number): Segment[][] {
  const pages: Segment[][] = [];
  let current: Segment[] = [];
  let used = 0;
  for (const piece of pieces) {
    const ls = lines[piece.key] ?? [];
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
      current.push({ piece, text: ls.slice(at, end).map((l) => l.text).join("").trimEnd(), ends: end === ls.length });
      used += h;
      at = end;
      if (at < ls.length) {
        pages.push(current);
        current = [];
        used = 0;
      }
    }
    used += piece.gapAfter * size;
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}
