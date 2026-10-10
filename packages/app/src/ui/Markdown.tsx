import type { ReactNode } from "react";
import { View } from "react-native";
import { font, useTheme } from "@/lib/theme";
import { Text } from "./Text";

/**
 * The little Markdown the tutor writes: paragraphs, bullet and numbered
 * lists, **bold**, *italic* and `code`. Enough for streamed answers; not a
 * general renderer.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)))
          return (
            <View key={i} style={{ gap: 4 }}>
              {lines.map((l, j) => {
                const m = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(l)!;
                return (
                  <View key={j} style={{ flexDirection: "row", gap: 8 }}>
                    <Text variant="muted">{/\d/.test(m[1]!) ? m[1] : "•"}</Text>
                    <Text style={{ flex: 1, fontSize: 15, lineHeight: 22 }}>{inline(m[2]!)}</Text>
                  </View>
                );
              })}
            </View>
          );
        return (
          <Text key={i} style={{ fontSize: 15, lineHeight: 22 }}>
            {inline(b.replace(/^#{1,6}\s+/gm, "").replace(/\n/g, " "))}
          </Text>
        );
      })}
    </View>
  );
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    const t = m[0];
    const key = `${m.index}`;
    if (t.startsWith("**") || t.startsWith("__")) out.push(<Bold key={key}>{t.slice(2, -2)}</Bold>);
    else if (t.startsWith("`")) out.push(<Code key={key}>{t.slice(1, -1)}</Code>);
    else out.push(<Italic key={key}>{t.slice(1, -1)}</Italic>);
    last = m.index! + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const Bold = ({ children }: { children: ReactNode }) => <Text style={{ fontFamily: font.semibold, fontSize: 15 }}>{children}</Text>;
const Italic = ({ children }: { children: ReactNode }) => <Text style={{ fontStyle: "italic", fontSize: 15 }}>{children}</Text>;
function Code({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={{ fontFamily: font.mono, fontSize: 14, backgroundColor: colors.surfaceSunken }}>{children}</Text>;
}
