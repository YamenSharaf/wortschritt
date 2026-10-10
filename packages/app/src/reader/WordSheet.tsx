import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWordLookup } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Text } from "@/ui/Text";

/** A tapped word: the dictionary's gloss and the first Wiktionary senses. */
export function WordSheet({ word, onClose }: { word: string; onClose: () => void }) {
  const { colors, radii, motion } = useTheme();
  const insets = useSafeAreaInsets();
  const { dict, details } = useWordLookup(word);
  const offline = useSync().status.state === "offline";
  const senses = details?.entries.flatMap((e) => e.senses).slice(0, 3) ?? [];
  return (
    <Modal transparent visible animationType={motion.base === 0 ? "none" : "slide"} onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={{
          backgroundColor: colors.surfaceRaised,
          borderTopLeftRadius: radii.panel,
          borderTopRightRadius: radii.panel,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 20,
          paddingBottom: insets.bottom + 20,
          gap: 8,
        }}
      >
        <Text variant="heading">{dict?.article ? `${dict.article} ${dict.lemma}` : (dict?.lemma ?? word)}</Text>
        {dict && dict.lemma.toLowerCase() !== word.toLowerCase() && <Text variant="subtle">from “{word}”</Text>}
        {dict === undefined && <Text variant="subtle">Looking up…</Text>}
        {dict?.gloss ? <Text>{dict.gloss}</Text> : null}
        {senses.map((s, i) => (
          <Text key={i} variant="muted">
            {i + 1}. {s.definition}
          </Text>
        ))}
        {dict === null && details === null && (
          <Text variant="muted">{offline ? "You're offline: looking words up needs a connection." : "No definition found."}</Text>
        )}
        <Pressable onPress={onClose} accessibilityRole="button" style={{ alignSelf: "flex-end", paddingVertical: 8, paddingHorizontal: 4 }}>
          <Text style={{ fontFamily: font.medium, color: colors.brandInk }}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
