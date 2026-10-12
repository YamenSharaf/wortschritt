import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { generateCounts, type ExerciseItem, type ExerciseProgress, type ExerciseSet } from "@mdb/shared";
import { preferences } from "@mdb/client";
import { useExerciseRunner, useExerciseSet, usePreference } from "@mdb/client/react";
import { useFeedback } from "@/lib/feedback";
import { font, useTheme } from "@/lib/theme";
import { ItemView } from "@/practice/ItemView";
import { TutorHelp } from "@/practice/TutorHelp";
import { QuestionSlide } from "@/practice/QuestionSlide";
import { Segmented } from "@/reader/ReaderSheets";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Icon } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Ellipsis, RotateCcw, Sparkles, X } from "lucide-react-native";

/** A set's exercises one at a time, as on the web (pages/ExercisePlayer). */
export default function ExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const loaded = useExerciseSet(id);
  const { colors } = useTheme();
  if (loaded.status === "loading")
    return (
      <Screen>
        <Text variant="muted">Loading…</Text>
      </Screen>
    );
  if (loaded.status === "error")
    return (
      <Screen>
        <BackLink label="Practice" />
        <Text style={{ color: colors.danger }}>This exercise set isn't here.</Text>
      </Screen>
    );
  return <Runner key={id} set={loaded.set} extra={loaded.extra} initial={loaded.initial} />;
}

function BackLink({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        minHeight: 44,
        flexShrink: 1,
      }}
    >
      <Icon icon={ChevronLeft} size={18} color={colors.inkMuted} />
      <Text
        numberOfLines={1}
        style={{
          fontFamily: font.medium,
          color: colors.inkMuted,
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Runner({ set, extra, initial }: { set: ExerciseSet; extra: ExerciseItem[]; initial: ExerciseProgress | null }) {
  const run = useExerciseRunner({ set, extra, initial });
  const { items, index, item, results, answered, lastCorrect, done, correctCount, answeredCount, next, goTo } = run;
  const { colors, radii, motion, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const [navOpen, setNavOpen] = useState(false);

  const feedback = useFeedback();
  // Which way the questions move (for the slide): forward unless going back.
  const lastIndex = useRef(index);
  const dir: 1 | -1 = index >= lastIndex.current ? 1 : -1;
  useEffect(() => {
    lastIndex.current = index;
  }, [index]);
  const [autoAdvance] = usePreference(preferences.autoAdvance);
  // A chime and a tap as the verdict comes in.
  useEffect(() => {
    if (answered && lastCorrect !== null) feedback.answer(lastCorrect);
  }, [answered, index]); // eslint-disable-line react-hooks/exhaustive-deps
  // After a right answer, move on by itself if set (a wrong one waits: read the answer, ask the tutor).
  useEffect(() => {
    if (!autoAdvance || !answered || !lastCorrect) return;
    const t = setTimeout(() => next(), motion.base === 0 ? 900 : 1100);
    return () => clearTimeout(t);
  }, [answered, lastCorrect, index, autoAdvance]); // eslint-disable-line react-hooks/exhaustive-deps

  if (done) {
    const pct = answeredCount ? Math.round((correctCount / answeredCount) * 100) : 0;
    return (
      <Screen>
        <Card style={{ padding: 24, gap: 12, alignItems: "center" }}>
          <View
            accessibilityLabel={`${correctCount} of ${answeredCount} correct`}
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              borderWidth: 8,
              borderColor: pct >= 50 ? colors.reward2 : colors.surfaceSunken,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text variant="number">
              {correctCount}/{answeredCount}
            </Text>
          </View>
          <Text variant="title">Set finished</Text>
          <Text variant="muted">
            {correctCount} of {answeredCount} correct
          </Text>
          <Text variant="subtle">{answeredCount === items.length ? "Whole set completed." : `${answeredCount} of ${items.length} questions answered.`}</Text>
          {run.assistantEnabled && (
            <View style={{ alignSelf: "stretch", gap: 8, marginTop: 8 }}>
              <Button
                label={run.generate.busy ? "Generating…" : `Generate ${run.generate.count} more like these`}
                busy={run.generate.busy}
                icon={<Icon icon={Sparkles} size={16} />}
                onPress={run.generate.run}
              />
              <View style={{ alignItems: "center" }}>
                <Segmented
                  value={String(run.generate.count)}
                  options={generateCounts.map((n) => [String(n), String(n)] as [string, string])}
                  onChange={(v) => run.generate.setCount(Number(v))}
                />
              </View>
              {run.generate.error ? (
                <View
                  style={{
                    padding: 12,
                    borderRadius: radii.control,
                    backgroundColor: colors.dangerSoft,
                  }}
                >
                  <Text style={{ color: colors.danger }}>{run.generate.error}</Text>
                </View>
              ) : null}
            </View>
          )}
          {run.extraCount > 0 && (
            <Text variant="muted" style={{ textAlign: "center" }}>
              This set includes {run.extraCount} extra {run.extraCount === 1 ? "exercise" : "exercises"} generated for you.{" "}
              <Text
                onPress={() => void run.removeExtras().catch(() => {})}
                style={{
                  fontFamily: font.medium,
                  color: colors.brandInk,
                  textDecorationLine: "underline",
                }}
              >
                Remove {run.extraCount === 1 ? "it" : "them"}
              </Text>
            </Text>
          )}
          <Button kind="primary" label="Back to practice" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  const prior = run.priorResult;
  const answeredEarlier = !answered && prior !== undefined;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* The question is a sheet filling the screen between the header and the buttons (at thumb height); it scrolls inside, swipes anywhere. */}
      <View style={{ flex: 1, width: "100%", maxWidth: 720, alignSelf: "center", paddingTop: insets.top + 16, paddingHorizontal: 20, gap: 12 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <BackLink label={set.title} />
        <Pressable
          onPress={() => setNavOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={navOpen ? "Hide question navigator" : "Show question navigator"}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: 44,
          }}
        >
          {answeredCount > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon icon={Check} size={14} color={colors.success} />
              <Text style={{ fontSize: 13, color: colors.success }}>{correctCount}</Text>
              <Icon icon={X} size={14} color={colors.danger} />
              <Text style={{ fontSize: 13, color: colors.danger }}>{answeredCount - correctCount}</Text>
            </View>
          )}
          <Text variant="number" style={{ fontSize: 13 }}>
            {index + 1} / {items.length}
          </Text>
          <Icon icon={navOpen ? ChevronUp : ChevronDown} size={14} color={colors.inkMuted} />
        </Pressable>
      </View>
      {set.subtitle ? <Text variant="subtle">{set.subtitle}</Text> : null}
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.surfaceSunken,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${(answeredCount / items.length) * 100}%`,
            height: "100%",
            backgroundColor: colors.reward2,
            borderRadius: 4,
          }}
        />
      </View>

      {navOpen && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {items.map((it, i) => {
            const mine = results[it.id];
            const prev = run.prevRun?.results[it.id];
            const current = i === index;
            const fg = mine !== undefined ? (mine ? colors.success : colors.danger) : prev !== undefined ? (prev ? colors.success : colors.danger) : colors.inkMuted;
            return (
              <Pressable
                key={it.id}
                onPress={() => goTo(i)}
                accessibilityRole="button"
                accessibilityLabel={`Go to question ${i + 1}${prev !== undefined ? `, last run: ${prev ? "correct" : "wrong"}` : ""}`}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  borderWidth: current ? 2 : 1,
                  borderStyle: mine === undefined && prev !== undefined ? "dashed" : "solid",
                  borderColor: current ? colors.focus : mine !== undefined ? "transparent" : prev !== undefined ? fg : colors.border,
                  backgroundColor: mine === undefined ? colors.surface : mine ? colors.successSoft : colors.dangerSoft,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: mine !== undefined ? font.semibold : font.regular,
                    color: fg,
                  }}
                >
                  {i + 1}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <QuestionSlide
        key={index}
        dir={dir}
        verdict={answered ? lastCorrect : null}
        animated={motion.base > 0}
        canPrev={index > 0}
        canNext={index + 1 < items.length || answered}
        onPrev={() => goTo(index - 1)}
        onNext={() => {
          feedback.tick();
          // Answered: on (or finish); not yet: skip it, as the Skip button does.
          if (answered) next();
          else goTo(index + 1);
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
          {/* Scrolls a focused field (an answer, the tutor chat) above the keyboard. */}
          <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ flexGrow: 1, padding: 20, paddingRight: run.isGenerated(item.id) ? 44 : 20, gap: 20 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <View>
          {answeredEarlier && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginBottom: 16,
              }}
            >
              <Icon icon={RotateCcw} size={14} color={colors.inkSubtle} />
              <Text variant="subtle" style={{ flex: 1 }}>
                You answered this{" "}
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: font.medium,
                    color: prior ? colors.success : colors.danger,
                  }}
                >
                  {prior ? "correctly" : "incorrectly"}
                </Text>{" "}
                this run. Answer again to change it.
              </Text>
            </View>
          )}
              <ItemView key={`${item.id}-${index}`} item={item} submit={run.submit} />
            </View>
            {run.assistantEnabled && (
              <View style={{ marginTop: "auto" }}>
                <TutorHelp key={item.id} item={item} answered={answered} lastCorrect={lastCorrect} lastResponse={run.lastResponse} />
              </View>
            )}
          </KeyboardAwareScrollView>
          {run.isGenerated(item.id) && (
            <Pressable
              onPress={() =>
                Alert.alert("Generated for you", "Your tutor wrote this exercise for you. Remove it from the set?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Remove",
                    style: "destructive",
                    onPress: () => void run.removeItem(item.id).catch((e) => Alert.alert("Couldn't remove it", e instanceof Error ? e.message : String(e))),
                  },
                ])
              }
              accessibilityRole="button"
              accessibilityLabel="More about this exercise"
              hitSlop={8}
              style={{ position: "absolute", top: 8, right: 8, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" }}
            >
              <Icon icon={Ellipsis} size={18} color={colors.inkSubtle} />
            </Pressable>
          )}
        </View>
      </QuestionSlide>

      <View style={{ flexDirection: "row", gap: 8, paddingTop: 4, paddingBottom: insets.bottom + 12 }}>
        <View style={{ flex: 1 }}>
          <Button label="Prev" icon={<Icon icon={ChevronLeft} size={16} />} disabled={index === 0} onPress={() => goTo(index - 1)} accessibilityLabel="Previous question" />
        </View>
        <View style={{ flex: 2 }}>
          {answered ? (
            <Button kind="primary" label={run.isLast ? "Finish" : "Next"} icon={<Icon icon={ChevronRight} size={16} color={colors.brandInk} />} onPress={next} />
          ) : (
            <Button kind="ghost" label="Skip" icon={<Icon icon={ChevronRight} size={16} />} disabled={index + 1 >= items.length} onPress={() => goTo(index + 1)} />
          )}
        </View>
      </View>
      </View>
    </KeyboardAvoidingView>
  );
}
