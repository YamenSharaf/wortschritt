import { View } from "react-native";
import { router } from "expo-router";
import type { Story } from "@mdb/shared";
import { font } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Icon, sections } from "@/ui/icons";
import { Text } from "@/ui/Text";
import type { ReaderColors } from "./style";

/**
 * After the text: the story's questions, offered (they open on their own
 * screen, one card at a time; going on to the next chapter skips them).
 */
export function StoryQuiz({ story, colors }: { story: Story; colors: ReaderColors }) {
  const n = story.questions.length;
  return (
    <View style={{ gap: 12, marginTop: 8, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: colors.rule }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 20, color: colors.fg }}>Fragen zum Text</Text>
      <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>
        {n} {n === 1 ? "question" : "questions"} to check you understood it. Skip them if you like.
      </Text>
      <View style={{ flexDirection: "row" }}>
        <Button kind="primary" label="Answer the questions" icon={<Icon icon={sections.practice.icon} size={16} />} onPress={() => router.push(`/quiz/${story.id}`)} />
      </View>
    </View>
  );
}
