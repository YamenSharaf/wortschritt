import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
  type TextStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
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
  /** The first paragraph on screen (where reading aloud starts). */
  firstPara(): number;
  /** Bring paragraph `i` on screen (reading aloud follows along). */
  showPara(i: number): void;
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
  /** The paragraph being read aloud (marked), if any. */
  speaking?: number | null;
  /** Pages slide (follow the finger); off on e-ink and with reduced motion. */
  animated?: boolean;
  /** A tap on the left or right quarter turns the page (else every tap shows or hides the bars). */
  tapToTurn?: boolean;
};

type Line = { text: string; height: number };
/** A piece's lines on one page; `at` is where it starts in the German text (paragraph + character), for keeping your place. */
type Segment = { piece: Piece; text: string; ends: boolean; at?: Pos };
type Pos = { para: number; char: number };
const before = (a: Pos, b: Pos) => a.para < b.para || (a.para === b.para && a.char <= b.char);

const H_PAD = 24;
const V_PAD = 24;
/** A swipe this long (dp), or this fast (dp/s) in its direction, turns the page. */
const SWIPE_DISTANCE = 40;
const SWIPE_VELOCITY = 350;

/**
 * Hidden English (peek), shuffled so the blur can't be read through: each
 * letter moves 13 along the alphabet (same case, same word lengths), the
 * rest stays. Tapping shows the real line.
 */
function scramble(text: string): string {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/** Text that doesn't show (its shadow still can). */
const INVISIBLE = "rgba(0,0,0,0.004)";

function styleFor(piece: Piece, t: Typography, c: ReaderColors): TextStyle {
  switch (piece.kind) {
    case "eyebrow":
      return { fontFamily: t.ui, fontSize: 12, lineHeight: 18, letterSpacing: 0.8, textTransform: "uppercase", color: c.muted };
    case "title":
      return { fontFamily: t.title, fontSize: t.size * 1.45, lineHeight: t.size * 1.45 * 1.25, color: c.fg };
    case "meta":
      return { fontFamily: t.ui, fontSize: 12, lineHeight: 18, color: c.muted };
    case "en": {
      const size = t.size * 0.78;
      const base: TextStyle = { fontFamily: t.ui, fontSize: size, lineHeight: size * 1.45, color: c.muted, opacity: piece.loading ? 0.6 : 1 };
      if (!piece.hidden) return base;
      // Peek, as on the web: the line blurred until tapped. The glyphs are all but
      // invisible (not "transparent": Android reads that as no colour, i.e. black)
      // and their shadow, blurred, is what shows. On e-ink a plain bar instead.
      if (c.eink) return { ...base, color: INVISIBLE, backgroundColor: rgbHex(hexToTriplet(c.muted), 0.22) };
      return {
        ...base,
        color: INVISIBLE,
        textShadowColor: rgbHex(hexToTriplet(c.muted), 0.9),
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: Math.round(size * 0.75),
      };
    }
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
  return p.mode === "scroll" ? <ScrollReader {...p} ref={ref} /> : <PagedReader {...p} ref={ref} />;
});

/** Told when a word or a hidden English line is pressed, so the page underneath doesn't treat it as a page-turn tap too. */
const TextTap = createContext<() => void>(() => {});

/** A piece's text with each word tappable (and saved ones underlined). */
function PieceText({ piece, text, style, p }: { piece: Piece; text: string; style: TextStyle; p: Props }) {
  const markTextTap = useContext(TextTap);
  if (piece.kind === "en") {
    return (
      <Text
        style={style}
        onPress={piece.hidden && piece.reveal ? () => p.onReveal(piece.reveal!) : undefined}
        onPressIn={piece.hidden && piece.reveal ? markTextTap : undefined}
        accessibilityLabel={piece.hidden ? "English, hidden. Tap to show." : undefined}
        suppressHighlighting
      >
        {piece.hidden ? scramble(text) : text}
      </Text>
    );
  }
  if (piece.kind !== "de" && piece.kind !== "title") return <Text style={style}>{text}</Text>;
  let at = 0;
  const reading = piece.kind === "de" && p.speaking === piece.para;
  return (
    <Text style={reading ? [style, { backgroundColor: p.colors.rule }] : style}>
      {tokens(text).map((t, i) => {
        const offset = at;
        at += t.text.length;
        if (!t.word) return t.text;
        const saved = p.isSaved?.(t.text);
        return (
          <Text
            key={i}
            onPress={() => p.onWord(t.text, sentenceAround(text, offset))}
            onPressIn={markTextTap}
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

const ScrollReader = forwardRef<ReaderControls, Props>(function ScrollReader(p, ref) {
  const scroller = useRef<ScrollView>(null);
  const tops = useRef<Record<number, number>>({});
  const content = useRef(0);
  const viewport = useRef(0);
  const scrollY = useRef(0);
  const restored = useRef(false);
  const textTapAt = useRef(0);
  const markTextTap = useCallback(() => {
    textTapAt.current = Date.now();
  }, []);
  const tapBeside = () => {
    if (Date.now() - textTapAt.current > 600) p.onCenter();
  };
  const { onProgress, onVisible } = p;

  useImperativeHandle(
    ref,
    () => ({
      turn: () => {},
      firstPara: () => {
        const on = Object.entries(tops.current).filter(([, top]) => top >= scrollY.current - 8);
        return on.length ? Math.min(...on.map(([para]) => Number(para))) : 0;
      },
      showPara: (i) => {
        const top = tops.current[i];
        if (top === undefined) return;
        // Only when it's off screen (or nearly), so the text doesn't jump for each paragraph.
        if (top < scrollY.current + 40 || top > scrollY.current + viewport.current * 0.75)
          scroller.current?.scrollTo({ y: Math.max(0, top - viewport.current * 0.25), animated: false });
      },
    }),
    [],
  );

  const report = useCallback(
    (y: number) => {
      scrollY.current = y;
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
      <TextTap.Provider value={markTextTap}>
        <View style={{ width: "100%", maxWidth: p.typo.maxWidth }}>
          {p.pieces.map((piece) => (
            <Pressable
              key={piece.key}
              onPress={tapBeside}
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
      </TextTap.Provider>
    </ScrollView>
  );
});

// --- pages -------------------------------------------------------------------

const PagedReader = forwardRef<ReaderControls, Props>(function PagedReader(p, ref) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [lines, setLines] = useState<Record<string, Line[]>>({});
  const [page, setPage] = useState(0);
  const restored = useRef(false);
  const lastCount = useRef(0);
  /**
   * Where you are in the German text (the start of the page): a re-layout
   * (size, font, English lines) brings you back to the page with it. Only a
   * page you turn to moves it, not a page a re-layout lands on, so repeated
   * re-layouts don't creep backwards.
   */
  const anchor = useRef<Pos | null>(null);
  const lastPage = useRef(-1);
  const layoutMove = useRef(false);
  const swipedAt = useRef(0);
  const textTapAt = useRef(0);
  const markTextTap = useCallback(() => {
    textTapAt.current = Date.now();
  }, []);

  const width = size ? Math.min(size.w - H_PAD * 2, p.typo.maxWidth) : 0;
  const styles = useMemo(() => new Map(p.pieces.map((x) => [x.key, styleFor(x, p.typo, p.colors)])), [p.pieces, p.typo, p.colors]);
  // A new layout (text, size or type): measure again.
  const layoutKey = `${width}x${size?.h}|${p.typo.regular}|${p.typo.size}|${p.typo.lineHeight}|${p.pieces.map((x) => `${x.key}:${x.text.length}`).join(",")}`;
  useEffect(() => setLines({}), [layoutKey]);

  const measured = size !== null && p.pieces.every((x) => lines[x.key]);
  const pages = useMemo(() => (size && measured ? paginate(p.pieces, lines, size.h - V_PAD * 2, p.typo.size) : []), [measured, lines, size, p.pieces, p.typo.size]);
  const count = pages.length;

  // Where to be once laid out: the server's resume point the first time, then the anchor.
  useEffect(() => {
    if (!count) return;
    if (!restored.current) {
      restored.current = true;
      lastCount.current = count;
      setPage(p.resumeAt === null ? 0 : Math.min(count - 1, Math.floor(p.resumeAt * count)));
      return;
    }
    // Stay on the end page; else the last page starting at or before your place.
    let target = 0;
    if (page >= lastCount.current && lastCount.current > 0) target = count;
    else if (anchor.current)
      pages.forEach((pg, i) => {
        const start = pg.find((x) => x.at)?.at;
        if (start && before(start, anchor.current!)) target = i;
      });
    lastCount.current = count;
    if (target !== page) {
      layoutMove.current = true;
      setPage(target);
    }
  }, [pages]); // eslint-disable-line react-hooks/exhaustive-deps

  const { onProgress, onPage, onVisible } = p;
  useEffect(() => {
    if (!count) return;
    if (page !== lastPage.current) {
      if (!layoutMove.current && page < count) anchor.current = pages[page]!.find((x) => x.at)?.at ?? anchor.current;
      layoutMove.current = false;
      lastPage.current = page;
    }
    onProgress(page / count);
    onPage?.(page, count);
    if (onVisible) onVisible([...new Set([...(pages[page] ?? []), ...(pages[page + 1] ?? [])].map((s) => s.piece.para).filter((x) => x >= 0))]);
  }, [page, count]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sliding pages (not on e-ink): every page sits at its own place in a long
  // strip (page n at n × width) and the strip moves, so finishing a slide
  // doesn't need a jump back. `pos` is the page in view (fractional mid-slide),
  // `drag` the finger's pull.
  const pageW = size?.w ?? 0;
  const pos = useSharedValue(0);
  const drag = useSharedValue(0);
  /** Where we're going: the page, or the one a slide is heading to (quick taps add up). */
  const aim = useRef(page);
  useLayoutEffect(() => {
    aim.current = page;
    pos.value = page;
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  const settle = useCallback((target: number) => setPage(target), []);
  const turn = useCallback(
    (d: number) => {
      const target = Math.max(0, Math.min(count, aim.current + d));
      if (target === aim.current) return;
      aim.current = target;
      if (!p.animated) return setPage(target);
      pos.value = withTiming(target, { duration: 240, easing: Easing.out(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(settle, target);
      });
    },
    [count, p.animated], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useImperativeHandle(
    ref,
    () => ({
      turn,
      firstPara: () => Math.max(0, pages[Math.min(page, count - 1)]?.find((x) => x.piece.para >= 0)?.piece.para ?? 0),
      showPara: (i) => {
        const at = pages.findIndex((pg) => pg.some((x) => x.piece.para === i));
        if (at >= 0) setPage(at);
      },
    }),
    [turn, pages, page, count],
  );

  const tapAt = (x: number) => {
    const w = size?.w ?? 0;
    if (p.tapToTurn === false) return p.onCenter();
    if (x < w * 0.25 && page > 0) turn(-1);
    else if (x > w * 0.75 && page < count) turn(1);
    else p.onCenter();
  };

  // A swipe is long enough or quick enough (a short flick counts); a mostly
  // vertical move isn't one. It cancels the tap underneath.
  const markSwiped = useCallback(() => {
    swipedAt.current = Date.now();
  }, []);
  const swipe = useMemo(() => {
    if (!p.animated)
      return Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-12, 12])
        .failOffsetY([-24, 24])
        .onEnd((e) => {
          const far = Math.abs(e.translationX) > SWIPE_DISTANCE;
          const fast = Math.abs(e.velocityX) > SWIPE_VELOCITY && Math.sign(e.velocityX) === Math.sign(e.translationX);
          if (!far && !fast) return;
          swipedAt.current = Date.now();
          turn(e.translationX < 0 ? 1 : -1);
        });
    // The page follows the finger, then slides on (or back).
    return Gesture.Pan()
      .activeOffsetX([-12, 12])
      .failOffsetY([-24, 24])
      .onStart(() => {
        scheduleOnRN(markSwiped);
      })
      .onUpdate((e) => {
        const from = Math.round(pos.value);
        const blocked = (e.translationX < 0 && from >= count) || (e.translationX > 0 && from <= 0);
        drag.value = blocked ? e.translationX * 0.25 : e.translationX;
      })
      .onEnd((e) => {
        const from = Math.round(pos.value);
        const far = Math.abs(e.translationX) > SWIPE_DISTANCE;
        const fast = Math.abs(e.velocityX) > SWIPE_VELOCITY && Math.sign(e.velocityX) === Math.sign(e.translationX);
        const target = far || fast ? Math.max(0, Math.min(count, from + (e.translationX < 0 ? 1 : -1))) : from;
        // Fold the pull into the position, then glide to the page.
        pos.value = pos.value - drag.value / pageW;
        drag.value = 0;
        pos.value = withTiming(target, { duration: 220, easing: Easing.out(Easing.cubic) }, (done) => {
          if (done && target !== from) scheduleOnRN(settle, target);
        });
      });
  }, [turn, p.animated, count, pageW]); // eslint-disable-line react-hooks/exhaustive-deps
  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: -pos.value * pageW + drag.value }] }));

  /** Page n's content (n === count is the end). */
  const pageView = (n: number) =>
    n < count ? (
      <View style={{ width }}>
        {pages[n]!.map((s, i) => (
          <View key={`${s.piece.key}-${i}`} style={{ marginBottom: s.ends ? s.piece.gapAfter * p.typo.size : 0 }}>
            <PieceText piece={s.piece} text={s.text} style={styles.get(s.piece.key)!} p={p} />
          </View>
        ))}
      </View>
    ) : (
      // flex: the end page scrolls within the page (the questions can run long).
      <ScrollView style={{ width, flex: 1 }} contentContainerStyle={{ paddingVertical: 16 }}>
        {p.ending}
      </ScrollView>
    );

  return (
    <View style={{ flex: 1, backgroundColor: p.colors.bg }} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
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
        <TextTap.Provider value={markTextTap}>
          <GestureDetector gesture={swipe}>
            <Pressable
              style={p.animated ? { flex: 1, overflow: "hidden" } : { flex: 1, paddingHorizontal: H_PAD, paddingVertical: V_PAD, alignItems: "center" }}
              onPress={(e) => {
                // Not after a swipe, nor when the tap was on a word or a hidden line (it has its own action).
                if (Date.now() - swipedAt.current > 300 && Date.now() - textTapAt.current > 600) tapAt(e.nativeEvent.pageX);
              }}
            >
              {p.animated ? (
                <Animated.View style={[StyleSheet.absoluteFill, strip]}>
                  {[page - 1, page, page + 1]
                    .filter((n) => n >= 0 && n <= count)
                    .map((n) => (
                      <View
                        key={n}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: n * pageW,
                          width: pageW,
                          paddingHorizontal: H_PAD,
                          paddingVertical: V_PAD,
                          alignItems: "center",
                          backgroundColor: p.colors.bg,
                        }}
                      >
                        {pageView(n)}
                      </View>
                    ))}
                </Animated.View>
              ) : (
                pageView(page)
              )}
            </Pressable>
          </GestureDetector>
        </TextTap.Provider>
      )}
    </View>
  );
});

/** Pack the pieces' lines into pages of `height`; a piece may run onto the next page. */
function paginate(pieces: Piece[], lines: Record<string, Line[]>, height: number, size: number): Segment[][] {
  const pages: Segment[][] = [];
  let current: Segment[] = [];
  let used = 0;
  // Characters of each paragraph's German already laid out (a paragraph can be several pieces, one per sentence).
  const paraChars = new Map<number, number>();
  for (const piece of pieces) {
    const ls = lines[piece.key] ?? [];
    const german = piece.kind === "de" && piece.para >= 0;
    let charAt = paraChars.get(piece.para) ?? 0;
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
      const text = ls
        .slice(at, end)
        .map((l) => l.text)
        .join("");
      current.push({ piece, text: text.trimEnd(), ends: end === ls.length, at: german ? { para: piece.para, char: charAt } : undefined });
      charAt += text.length;
      used += h;
      at = end;
      if (at < ls.length) {
        pages.push(current);
        current = [];
        used = 0;
      }
    }
    used += piece.gapAfter * size;
    if (german) paraChars.set(piece.para, charAt);
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}
