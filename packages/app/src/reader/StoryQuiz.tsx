import { Pressable, View } from "react-native";
import type { Story } from "@mdb/shared";
import { useStoryQuiz } from "@mdb/client/react";
import { font, useTheme } from "@/lib/theme";
import { ItemView } from "@/practice/ItemView";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import type { ReaderColors } from "./style";

/** A story's comprehension questions after the text; answers count as set "story:<id>" (queued offline). */
export function StoryQuiz({ story, colors, onFinished }: { story: Story; colors: ReaderColors; onFinished: () => void }) {
  const quiz = useStoryQuiz(story, onFinished);
  const t = useTheme();
  return (
    <View style={{ gap: 12, marginTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 20, color: colors.fg }}>Fragen zum Text</Text>
        <Text style={{ fontFamily: font.mono, fontSize: 13, color: colors.muted }}>
          {quiz.answered}/{quiz.total}
        </Text>
      </View>
      {story.questions.map((q, i) => (
        <Card key={`${quiz.round}-${q.id}`} style={{ padding: 18 }}>
          <Text variant="eyebrow" style={{ marginBottom: 10 }}>
            Frage {i + 1}
          </Text>
          <ItemView item={q} submit={(response) => quiz.answer(q, response)} />
        </Card>
      ))}
      {quiz.done && (
        <Card style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={{ fontFamily: font.semibold, flex: 1 }}>
            {quiz.correct}/{quiz.total} richtig
          </Text>
          <Pressable onPress={quiz.retry} accessibilityRole="button" hitSlop={8}>
            <Text style={{ fontFamily: font.medium, color: t.colors.brandInk }}>Try again</Text>
          </Pressable>
        </Card>
      )}
    </View>
  );
}
