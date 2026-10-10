import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { preferences } from "@mdb/client";
import { usePreference, useStory, useStoryQuiz } from "@mdb/client/react";
import { useFeedback } from "@/lib/feedback";
import { font, useTheme } from "@/lib/theme";
import { ItemView } from "@/practice/ItemView";
import { QuestionSlide } from "@/practice/QuestionSlide";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Icon } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react-native";

/**
 * A story's questions, one card at a time (as the exercises): swipe or use
 * the bar to move, skip any, and see the score at the end. Answers count as
 * set "story:<id>" (queued offline).
 */
export default function StoryQuestions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { view, showRead } = useStory(id);
  const { colors } = useTheme();
  if (!view)
    return (
      <Screen dock={false}>
        <Text variant="muted">Loading…</Text>
      </Screen>
    );
  if (view.story.questions.length === 0)
    return (
      <Screen dock={false}>
        <Text style={{ color: colors.danger }}>This story has no questions.</Text>
      </Screen>
    );
  return <Questions view={view} onFinished={showRead} />;
}

function Questions({ view, onFinished }: { view: NonNullable<ReturnType<typeof useStory>["view"]>; onFinished: () => void }) {
  const story = view.story;
  const quiz = useStoryQuiz(story, onFinished);
  const { colors, radii, motion, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const feedback = useFeedback();
  const [autoAdvance] = usePreference(preferences.autoAdvance);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [finished, setFinished] = useState(false);
  const qs = story.questions;
  const q = qs[index]!;
  const mine = results[q.id];
  const last = index + 1 >= qs.length;

  const lastIndex = useRef(index);
  const dir: 1 | -1 = index >= lastIndex.current ? 1 : -1;
  useEffect(() => {
    lastIndex.current = index;
  }, [index]);

  const next = () => (last ? setFinished(true) : setIndex(index + 1));

  // Right: on by itself, if set (wrong waits, to read the answer).
  useEffect(() => {
    if (!autoAdvance || mine !== true) return;
    const t = setTimeout(next, motion.base === 0 ? 900 : 1100);
    return () => clearTimeout(t);
  }, [mine, index, autoAdvance]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = (
    <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, flexShrink: 1 }}>
      <Icon icon={ChevronLeft} size={18} color={colors.inkMuted} />
      <Text numberOfLines={1} style={{ fontFamily: font.medium, color: colors.inkMuted, flexShrink: 1 }}>
        {story.title}
      </Text>
    </Pressable>
  );

  if (finished) {
    const answered = Object.keys(results).length;
    const correct = Object.values(results).filter(Boolean).length;
    return (
      <Screen dock={false}>
        {back}
        <Card style={{ padding: 24, gap: 12, alignItems: "center" }}>
          <View
            accessibilityLabel={`${correct} of ${qs.length} right`}
            style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 8, borderColor: correct * 2 >= qs.length ? colors.reward2 : colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}
          >
            <Text variant="number">
              {correct}/{qs.length}
            </Text>
          </View>
          <Text variant="title">{correct === qs.length ? "Alles richtig!" : `${correct} von ${qs.length} richtig`}</Text>
          {answered < qs.length && <Text variant="muted">{qs.length - answered} skipped.</Text>}
          <View style={{ alignSelf: "stretch", gap: 8, marginTop: 8 }}>
            <Button kind="primary" label="Back to the story" onPress={() => router.back()} />
            <Button
              label="Try again"
              icon={<Icon icon={RotateCcw} size={16} />}
              onPress={() => {
                quiz.retry();
                setResults({});
                setIndex(0);
                setFinished(false);
              }}
            />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, width: "100%", maxWidth: 720, alignSelf: "center", paddingTop: insets.top + 16, paddingHorizontal: 20, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {back}
          <Text variant="number" style={{ fontSize: 13 }}>
            {index + 1} / {qs.length}
          </Text>
        </View>
        <Text variant="eyebrow">Fragen zum Text</Text>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
          <View style={{ width: `${(Object.keys(results).length / qs.length) * 100}%`, height: "100%", backgroundColor: colors.reward2, borderRadius: 4 }} />
        </View>

        <QuestionSlide
          key={`${quiz.round}-${index}`}
          dir={dir}
          verdict={mine ?? null}
          animated={motion.base > 0}
          canPrev={index > 0}
          canNext
          onPrev={() => setIndex(index - 1)}
          onNext={() => {
            feedback.tick();
            next();
          }}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radii.panel,
              boxShadow: elevation.cardHover === "none" ? undefined : elevation.cardHover,
              overflow: "hidden",
            }}
          >
            <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
              <Text variant="eyebrow">Frage {index + 1}</Text>
              {mine !== undefined && (
                <Text variant="subtle">
                  You answered this{" "}
                  <Text style={{ fontSize: 13, fontFamily: font.medium, color: mine ? colors.success : colors.danger }}>{mine ? "correctly" : "incorrectly"}</Text>.
                </Text>
              )}
              <ItemView
                key={`${quiz.round}-${q.id}`}
                item={q}
                submit={async (response) => {
                  const v = await quiz.answer(q, response);
                  setResults((r) => (q.id in r ? r : { ...r, [q.id]: v.correct }));
                  feedback.answer(v.correct);
                  return v;
                }}
              />
            </ScrollView>
          </View>
        </QuestionSlide>

        <View style={{ flexDirection: "row", gap: 8, paddingTop: 4, paddingBottom: insets.bottom + 12 }}>
          <View style={{ flex: 1 }}>
            <Button label="Prev" icon={<Icon icon={ChevronLeft} size={16} />} disabled={index === 0} onPress={() => setIndex(index - 1)} accessibilityLabel="Previous question" />
          </View>
          <View style={{ flex: 2 }}>
            {mine !== undefined ? (
              <Button kind="primary" label={last ? "Finish" : "Next"} icon={<Icon icon={ChevronRight} size={16} color={colors.brandInk} />} onPress={next} />
            ) : (
              <Button kind="ghost" label={last ? "Finish" : "Skip"} icon={<Icon icon={ChevronRight} size={16} />} onPress={next} />
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
