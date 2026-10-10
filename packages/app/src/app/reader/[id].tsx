import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStory } from "@mdb/client/react";
import { font, useTheme } from "@/lib/theme";
import { plainParagraphs, rgbHex } from "@/reader/text";
import { RNReader } from "@/reader/RNReader";
import { WordSheet } from "@/reader/WordSheet";
import { Text } from "@/ui/Text";

/**
 * A story in the reader (issue #2, phase 1): pages or scroll, the text size,
 * tap a word to define it; the middle of the page shows or hides the bars.
 */
export default function Reader() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { view, error } = useStory(id);
  const theme = useTheme();
  const { colors } = theme;
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"pages" | "scroll">("pages");
  const [fontSize, setFontSize] = useState(19);
  const [chrome, setChrome] = useState(true);
  const [word, setWord] = useState<string | null>(null);
  const [where, setWhere] = useState<{ page: number; count: number } | null>(null);

  const paragraphs = useMemo(() => (view ? plainParagraphs(view.story.body) : []), [view]);
  const palette = theme.reader[theme.scheme];
  const textColor = rgbHex(palette.fg);
  const pageColor = rgbHex(palette.bg);

  const common = {
    storyTitle: view?.story.title ?? "",
    paragraphs,
    mode,
    fontSize,
    lineHeight: 1.6,
    serif: true,
    textColor,
    pageColor,
  };

  return (
    <View style={{ flex: 1, backgroundColor: pageColor, paddingTop: insets.top }}>
      {chrome && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: rgbHex(palette.rule) }}>
          <Chip label="‹ Back" onPress={() => router.back()} color={textColor} />
          <View style={{ flex: 1 }} />
          <Segment value={mode} onChange={setMode} options={[["pages", "Pages"], ["scroll", "Scroll"]]} color={textColor} rule={rgbHex(palette.rule)} />
          <Chip label="A−" onPress={() => setFontSize((s) => Math.max(14, s - 1))} color={textColor} />
          <Chip label="A+" onPress={() => setFontSize((s) => Math.min(30, s + 1))} color={textColor} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        {error && <Text style={{ color: colors.danger, padding: 24 }}>{error}</Text>}
        {view && (
          <RNReader
            {...common}
            onWord={(w) => setWord(w)}
            onPage={(page, count) => setWhere({ page, count })}
            onCenter={() => setChrome((c) => !c)}
          />
        )}
      </View>
      {mode === "pages" && where && (
        <View style={{ paddingBottom: insets.bottom + 6, paddingTop: 4, alignItems: "center" }}>
          <Text style={{ fontFamily: font.mono, fontSize: 12, color: rgbHex(palette.muted) }}>
            {where.page + 1} / {where.count}
          </Text>
        </View>
      )}
      {word && <WordSheet word={word} onClose={() => setWord(null)} />}
    </View>
  );
}

function Chip({ label, onPress, color }: { label: string; onPress: () => void; color: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: 36, minWidth: 36, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: font.medium, fontSize: 14, color }}>{label}</Text>
    </Pressable>
  );
}

function Segment<T extends string>({
  value,
  onChange,
  options,
  color,
  rule,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
  color: string;
  rule: string;
}) {
  return (
    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: rule, borderRadius: 999, padding: 2 }}>
      {options.map(([v, label]) => (
        <Pressable
          key={v}
          onPress={() => onChange(v)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === v }}
          style={{ minHeight: 32, paddingHorizontal: 10, justifyContent: "center", borderRadius: 999, backgroundColor: value === v ? rule : "transparent" }}
        >
          <Text style={{ fontFamily: value === v ? font.semibold : font.regular, fontSize: 13, color }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
