import { Alert, Pressable, TextInput, View } from "react-native";
import type { ExerciseItem } from "@mdb/shared";
import { describeItem } from "@mdb/client";
import { useTutorChat } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Icon } from "@/ui/icons";
import { Markdown } from "@/ui/Markdown";
import { Text } from "@/ui/Text";
import { ArrowUp, Languages, Lightbulb, Sparkles, X } from "lucide-react-native";

/** The tutor on one item: hint and translate (buttons in the bar), and its reply (a panel in the card). */
export function useTutor(item: ExerciseItem, lastResponse?: string) {
  const tutor = useTutorChat({ item: describeItem(item), response: lastResponse });
  const offline = useSync().status.state === "offline";
  return { ...tutor, offline };
}
export type Tutor = ReturnType<typeof useTutor>;

/** Hint and Translate as icon buttons for the bar (their names for screen readers, and on a long press). */
export function TutorButtons({ tutor }: { tutor: Tutor }) {
  const { colors, radii } = useTheme();
  const { shot } = tutor;
  const button = (label: string, icon: typeof Lightbulb, on: boolean, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      onLongPress={() => Alert.alert(label, label === "Hint" ? "A nudge from your tutor, without the answer." : "The sentence in English.")}
      disabled={tutor.offline}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={tutor.offline ? "The tutor needs a connection" : undefined}
      accessibilityState={{ selected: on, disabled: tutor.offline }}
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radii.control,
        borderWidth: 1,
        borderColor: on ? "transparent" : colors.border,
        backgroundColor: on ? colors.brandSoft : pressed ? colors.surfaceSunken : "transparent",
        opacity: tutor.offline ? 0.45 : 1,
      })}
    >
      <Icon icon={icon} size={20} color={on ? colors.brandInk : colors.inkMuted} />
    </Pressable>
  );
  return (
    <>
      {button("Hint", Lightbulb, shot?.kind === "hint", tutor.hint)}
      {button("Translate", Languages, shot?.kind === "translate", tutor.translate)}
    </>
  );
}

/** The tutor's reply under the question, and "Why was I wrong?" after a wrong answer (as a chat). */
export function TutorPanel({ tutor, answered, lastCorrect, lastResponse }: { tutor: Tutor; answered: boolean; lastCorrect: boolean | null; lastResponse?: string }) {
  const { colors, radii } = useTheme();
  const { shot, chat } = tutor;
  const showWhyWrong = answered && lastCorrect === false && lastResponse !== undefined && !tutor.offline;
  const title = chat ? "Why it was wrong" : shot?.kind === "hint" ? "Hint" : "Translation";
  if (!shot && !chat && !showWhyWrong) return null;

  const chip = (label: string, icon: typeof Lightbulb, on: boolean, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{
        alignSelf: "flex-start",
        minHeight: 36,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? "transparent" : colors.border,
        backgroundColor: on ? colors.brandSoft : colors.surface,
      }}
    >
      <Icon icon={icon} size={14} color={on ? colors.brandInk : colors.inkMuted} />
      <Text style={{ fontSize: 13, fontFamily: font.medium, color: on ? colors.brandInk : colors.inkMuted }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 12 }}>
      {showWhyWrong && !chat && chip("Why was I wrong?", Sparkles, false, tutor.whyWrong)}
      {(shot || chat) && (
        <View style={{ borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Icon icon={Sparkles} size={14} color={colors.brand} />
            <Text style={{ fontFamily: font.semibold, fontSize: 14 }}>Tutor</Text>
            <Text variant="subtle">· {title}</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={tutor.close} accessibilityRole="button" accessibilityLabel="Close tutor" hitSlop={10}>
              <Icon icon={X} size={16} color={colors.inkSubtle} />
            </Pressable>
          </View>
          {shot && (
            <View style={{ padding: 14 }}>
              {shot.error ? <Text style={{ color: colors.danger }}>{shot.error}</Text> : shot.text ? <Markdown text={shot.text} /> : <Text variant="subtle">Thinking…</Text>}
            </View>
          )}
          {chat && (
            <>
              <View style={{ padding: 14, gap: 12 }}>
                {chat.msgs.map((m, i) =>
                  m.role === "assistant" ? (
                    m.content ? <Markdown key={i} text={m.content} /> : <Text key={i} variant="subtle">Thinking…</Text>
                  ) : (
                    <View key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.brandSoft }}>
                      <Text style={{ fontSize: 14 }}>{m.content}</Text>
                    </View>
                  ),
                )}
                {chat.error ? <Text style={{ color: colors.danger }}>{chat.error}</Text> : null}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                <TextInput
                  value={chat.input}
                  onChangeText={tutor.setInput}
                  onSubmitEditing={tutor.send}
                  placeholder="Ask a follow-up…"
                  placeholderTextColor={colors.inkSubtle}
                  accessibilityLabel="Ask the tutor a follow-up question"
                  style={{ flex: 1, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.surfaceSunken, color: colors.ink, fontFamily: font.regular }}
                />
                <Pressable
                  onPress={tutor.send}
                  disabled={chat.busy || !chat.input.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand, opacity: chat.busy || !chat.input.trim() ? 0.4 : 1 }}
                >
                  <Icon icon={ArrowUp} size={18} color={colors.onBrand} />
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}
