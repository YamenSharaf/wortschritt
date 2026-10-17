import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ScrollView, Text as RNText, View } from "react-native";
import { font, useTheme } from "@/lib/theme";
import { sentenceAround, tokens } from "@/reader/text";
import { Text } from "./Text";

/** Called with a tapped word and the sentence around it. */
type OnWord = (word: string, context: string) => void;
const WordTap = createContext<OnWord | undefined>(undefined);
const Size = createContext(15);

/**
 * The Markdown the app shows: the tutor's answers and the cheat sheets.
 * Paragraphs, headings, bullet and numbered lists, quotes, tables, **bold**,
 * *italic* and `code`; not a general renderer. With `onWord`, each word can
 * be tapped (to look it up).
 */
export function Markdown({ text, onWord, size = 15, limit }: { text: string; onWord?: OnWord; size?: number; limit?: number }) {
  // A long text shows its first `limit` blocks (the screen asks for more as you scroll): every
  // tappable word is a view of its own, and tens of thousands at once is more than a phone manages.
  const all = useMemo(() => blocks(text), [text]);
  const shown = limit === undefined ? all : all.slice(0, limit);
  return (
    <WordTap.Provider value={onWord}>
      <Size.Provider value={size}>
        <View style={{ gap: Math.round(size * 0.66) }}>
          {shown.map((b, i) => (
            <Block key={i} lines={b} />
          ))}
        </View>
      </Size.Provider>
    </WordTap.Provider>
  );
}

const MAX_BLOCK_LINES = 24;

/** Blocks: runs of lines between blank lines, with a table or quote kept as its own block. */
function blocks(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  const kind = (l: string) => (/^\s*\|/.test(l) ? "table" : /^\s*>/.test(l) ? "quote" : "text");
  for (const line of text.trim().split("\n")) {
    if (!line.trim()) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    // A new kind starts a block; so does a very long run of lines (a note written without blank
    // lines would otherwise be one paragraph of thousands of words, too much for one text view).
    if (cur.length && (kind(cur[cur.length - 1]!) !== kind(line) || (kind(line) === "text" && cur.length >= MAX_BLOCK_LINES))) {
      out.push(cur);
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length) out.push(cur);
  return out;
}

const LIST = /^\s*([-*+•]|\d+[.)])\s+(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;

type Part =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; items: { marker: string; depth: number; text: string }[] }
  | { kind: "para"; text: string };

/**
 * A block's lines as headings, lists and paragraphs: a list can follow its
 * lead-in line ("Here's why:") without a blank line, and an indented line
 * after an item continues that item.
 */
export function parts(lines: string[]): Part[] {
  const out: Part[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const h = HEADING.exec(line);
    const li = LIST.exec(line);
    if (h) out.push({ kind: "heading", level: h[1]!.length, text: h[2]! });
    else if (li) {
      const item = { marker: /\d/.test(li[1]!) ? li[1]! : "•", depth: Math.min(3, Math.floor(/^\s*/.exec(line)![0].length / 2)), text: li[2]! };
      if (prev?.kind === "list") prev.items.push(item);
      else out.push({ kind: "list", items: [item] });
    } else if (prev?.kind === "list" && /^\s+\S/.test(line)) {
      const last = prev.items[prev.items.length - 1]!;
      last.text += ` ${line.trim()}`;
    } else if (prev?.kind === "para") prev.text += ` ${line.trim()}`;
    else out.push({ kind: "para", text: line.trim() });
  }
  return out;
}

function Block({ lines }: { lines: string[] }) {
  const { colors } = useTheme();
  const size = useContext(Size);
  const first = lines[0]!;
  if (/^\s*\|/.test(first)) return <Table lines={lines} />;
  if (/^\s*>/.test(first))
    return (
      <View style={{ borderLeftWidth: 3, borderLeftColor: colors.borderStrong, paddingLeft: 12, gap: 4 }}>
        {lines.map((l, i) => (
          <Body key={i} text={l.replace(/^\s*>\s?/, "")} muted />
        ))}
      </View>
    );
  const ps = parts(lines);
  const rendered = ps.map((p, i) => {
    if (p.kind === "heading")
      return (
        <Text key={i} style={{ fontFamily: font.semibold, fontSize: size + (p.level <= 2 ? 3 : 1), lineHeight: Math.round((size + 3) * 1.4), color: colors.ink }}>
          <Inline text={p.text} />
        </Text>
      );
    if (p.kind === "list")
      return (
        <View key={i} style={{ gap: 4 }}>
          {p.items.map((it, j) => (
            <View key={j} style={{ flexDirection: "row", gap: 8, paddingLeft: it.depth * 16 }}>
              <Text variant="muted" style={{ fontSize: size, lineHeight: Math.round(size * 1.5) }}>
                {it.marker}
              </Text>
              <View style={{ flex: 1 }}>
                <Body text={it.text} />
              </View>
            </View>
          ))}
        </View>
      );
    return <Body key={i} text={p.text} />;
  });
  return rendered.length === 1 ? rendered[0]! : <View style={{ gap: Math.round(size * 0.4) }}>{rendered}</View>;
}

function Body({ text, muted }: { text: string; muted?: boolean }) {
  const { colors } = useTheme();
  const size = useContext(Size);
  return (
    <Text style={{ fontSize: size, lineHeight: Math.round(size * 1.5), color: muted ? colors.inkMuted : colors.ink }}>
      <Inline text={text} />
    </Text>
  );
}

/** A table that scrolls sideways when it's wider than the screen; the first row is the header. */
function Table({ lines }: { lines: string[] }) {
  const { colors, radii } = useTheme();
  const rows = lines
    .filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim()),
    );
  const cols = Math.max(...rows.map((r) => r.length));
  // Column widths from the longest cell (cells rarely wrap in a sheet's table).
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.min(220, Math.max(64, Math.max(...rows.map((r) => (r[c] ?? "").replace(/[*_`]/g, "").length)) * 8.5 + 20)),
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radii.control, overflow: "hidden", marginHorizontal: 4 }}>
        {rows.map((r, i) => (
          <View
            key={i}
            style={{
              flexDirection: "row",
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.border,
              backgroundColor: i === 0 ? colors.surfaceSunken : "transparent",
            }}
          >
            {widths.map((w, c) => (
              <View key={c} style={{ width: w, paddingHorizontal: 10, paddingVertical: 8, borderLeftWidth: c === 0 ? 0 : 1, borderLeftColor: colors.border }}>
                <Text style={{ fontSize: 14, lineHeight: 20, color: colors.ink, fontFamily: i === 0 || c === 0 ? font.semibold : font.regular }}>
                  <Inline text={r[c] ?? ""} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** Emphasis and code within a line; plain words are tappable when the Markdown has `onWord`. */
function Inline({ text }: { text: string }) {
  const onWord = useContext(WordTap);
  const plain = text.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(\*|_)(.+?)\1/g, "$2").replace(/`([^`]+)`/g, "$1");
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  const words = (s: string, key: string) => (onWord ? <Words key={key} text={s} context={plain} onWord={onWord} /> : s);
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(words(text.slice(last, m.index), `t${last}`));
    const t = m[0];
    const key = `${m.index}`;
    if (t.startsWith("**") || t.startsWith("__")) out.push(<Bold key={key}>{words(t.slice(2, -2), `b${key}`)}</Bold>);
    else if (t.startsWith("`")) out.push(<Code key={key}>{t.slice(1, -1)}</Code>);
    else out.push(<Italic key={key}>{words(t.slice(1, -1), `i${key}`)}</Italic>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(words(text.slice(last), `t${last}`));
  return <>{out}</>;
}

function Words({ text, context, onWord }: { text: string; context: string; onWord: OnWord }) {
  const at = Math.max(0, context.indexOf(text));
  return (
    <>
      {tokens(text).map((t, i) =>
        t.word ? (
          <RNText key={i} onPress={() => onWord(t.text, sentenceAround(context, at))} suppressHighlighting>
            {t.text}
          </RNText>
        ) : (
          t.text
        ),
      )}
    </>
  );
}

const Bold = ({ children }: { children: ReactNode }) => <RNText style={{ fontFamily: font.semibold }}>{children}</RNText>;
const Italic = ({ children }: { children: ReactNode }) => <RNText style={{ fontStyle: "italic" }}>{children}</RNText>;
function Code({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <RNText style={{ fontFamily: font.mono, fontSize: 14, backgroundColor: colors.surfaceSunken }}>{children}</RNText>;
}
