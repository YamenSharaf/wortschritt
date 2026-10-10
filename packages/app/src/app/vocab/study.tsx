import { useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formChips, preferences } from "@mdb/client";
import { filterVocab, useFlashcards, usePreference, useSpeech, useVocabState } from "@mdb/client/react";
import { font, useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Icon } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { SpeakButton } from "@/ui/SpeakButton";
import { useFeedback } from "@/lib/feedback";
import { GlassBackdrop, SwipeCard, type SwipeCardHandle } from "@/vocab/SwipeCard";
import { Check, ChevronLeft, RotateCcw, X } from "lucide-react-native";

/** Flashcards for a group (or all words), as on the web. */
export default function Flashcards() {
  const { group: groupParam = "all" } = useLocalSearchParams<{
    group?: string;
  }>();
  const { entries, groups, recordStudy } = useVocabState();
  const { colors, radii, motion } = useTheme();
  // Glass, flips and swipes, except on e-ink and with reduced motion.
  const animated = motion.base > 0;
  const insets = useSafeAreaInsets();
  const feedback = useFeedback();
  const speech = useSpeech();
  const [tipDone, setTipDone] = usePreference(preferences.flashcardTipDone);
  const cardRef = useRef<SwipeCardHandle>(null);
  /** Bumped on each new round, so the cards mount afresh. */
  const [deck, setDeck] = useState(0);
  const groupId = groupParam === "all" ? null : Number(groupParam);
  const groupName = groupId == null ? "All words" : (groups.find((g) => g.id === groupId)?.name ?? "Group");
  const pool = useMemo(() => filterVocab(entries, { group: groupId }), [entries, groupId]);
  const [dir, setDir] = usePreference(preferences.flashcardSide);
  const session = useFlashcards(pool, recordStudy);
  const { phase, queue, index: i, card: word, flipped, setFlipped, grade } = session;
  const start: typeof session.start = (list) => {
    setDeck((d) => d + 1);
    session.start(list);
  };
  const rate = (known: boolean) => {
    if (known) feedback.answer(true);
    else feedback.tick();
    grade(known);
  };

  const back = (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        minHeight: 44,
      }}
    >
      <Icon icon={ChevronLeft} size={18} color={colors.inkMuted} />
      <Text style={{ fontFamily: font.medium, color: colors.inkMuted }}>Vocab</Text>
    </Pressable>
  );

  if (phase === "loading")
    return (
      <Screen dock={false}>
        {back}
        <Text variant="muted">{entries.length > 0 && pool.length === 0 ? `No words in “${groupName}” yet. Add some, then come back to study.` : "Loading…"}</Text>
      </Screen>
    );

  if (phase === "done") {
    const { knownCount, missed, percent } = session;
    return (
      <Screen dock={false}>
        {back}
        <Card style={{ padding: 24, gap: 12, alignItems: "center" }}>
          <View
            accessibilityLabel={`${percent} percent known`}
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              borderWidth: 8,
              borderColor: percent >= 50 ? colors.reward2 : colors.surfaceSunken,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text variant="number">{percent}%</Text>
          </View>
          <Text variant="muted" style={{ textAlign: "center" }}>
            You knew <Text style={{ fontFamily: font.semibold }}>{knownCount}</Text> of {queue.length} in “{groupName}”.
          </Text>
          <View style={{ alignSelf: "stretch", gap: 8, marginTop: 8 }}>
            {missed.length > 0 && (
              <Button
                kind="primary"
                label={`Review the ${missed.length} you missed`}
                icon={<Icon icon={RotateCcw} size={16} color={colors.brandInk} />}
                onPress={() => start(missed)}
              />
            )}
            <Button label={`Study all ${pool.length} again`} onPress={() => start(pool)} />
            <Button kind="ghost" label="Done" onPress={() => router.back()} />
          </View>
        </Card>
      </Screen>
    );
  }

  if (!word) return null;
  const prompt = dir === "de" ? word.display : word.translation;
  const answer = dir === "de" ? word.translation : word.display;
  const chips = formChips(word.forms);
  const promptFace = (
    <>
      <Text variant="eyebrow">{dir === "de" ? "German" : "English"}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginTop: 4,
        }}
      >
        <Text
          style={{
            flexShrink: 1,
            fontFamily: font.semibold,
            fontSize: 32,
            lineHeight: 40,
            letterSpacing: -0.6,
          }}
        >
          {prompt}
        </Text>
        {!animated && (dir === "de" || flipped) && <SpeakButton text={word.display} size={22} />}
      </View>
    </>
  );
  const answerFace = (
    <View
      style={{
        marginTop: 20,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        gap: 10,
      }}
    >
      <Text variant="eyebrow">{dir === "de" ? "English" : "German"}</Text>
      <Text style={{ fontSize: 20, lineHeight: 28 }}>{answer}</Text>
      {chips.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {chips.map(([label, val]) => (
            <View
              key={label}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surfaceSunken,
              }}
            >
              <Text style={{ fontSize: 12 }}>
                <Text style={{ fontSize: 12, color: colors.inkSubtle }}>{label}: </Text>
                <Text style={{ fontSize: 12, fontFamily: font.medium }}>{val}</Text>
              </Text>
            </View>
          ))}
        </View>
      )}
      {word.examples.slice(0, 2).map((ex, k) => (
        <View
          key={k}
          style={{
            padding: 10,
            borderRadius: radii.control,
            backgroundColor: colors.surfaceSunken,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
            <Text style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>{ex.de}</Text>
            <SpeakButton text={ex.de} size={16} />
          </View>
          <Text variant="muted" style={{ fontSize: 14, lineHeight: 20 }}>
            {ex.en}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, overflow: "hidden" }}>
      {animated && <GlassBackdrop />}
      {/* The card takes the room between the header and the buttons (at thumb height), no scrolling. */}
      <View style={{ flex: 1, width: "100%", maxWidth: 720, alignSelf: "center", paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16, paddingHorizontal: 20, gap: 16 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {back}
          <Button
            label={dir === "de" ? "DE → EN" : "EN → DE"}
            accessibilityLabel="Switch which side is shown first"
            onPress={() => {
              setDir((d) => (d === "de" ? "en" : "de"));
              setFlipped(false);
            }}
          />
        </View>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text variant="subtle" style={{ fontFamily: font.medium }}>
              {groupName}
            </Text>
            <Text variant="subtle" style={{ fontFamily: font.medium }}>
              {i + 1} / {queue.length}
            </Text>
          </View>
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
                width: `${((i + (flipped ? 0.5 : 0)) / queue.length) * 100}%`,
                height: "100%",
                backgroundColor: colors.reward2,
              }}
            />
          </View>
        </View>

        <View style={{ flex: 1 }}>
        {animated ? (
          <SwipeCard
            key={`${deck}-${i}`}
            ref={cardRef}
            flipped={flipped}
            onFlip={() => setFlipped((f) => !f)}
            onDrag={feedback.tick}
            onDoubleTap={() => speech.speak(word.display)}
            onGrade={rate}
            front={promptFace}
            back={
              <>
                {promptFace}
                {answerFace}
              </>
            }
          />
        ) : (
          <Pressable style={{ flex: 1 }} onPress={() => setFlipped(true)} accessibilityRole="button" accessibilityHint={flipped ? undefined : "Shows the answer"}>
            <View
              style={{
                flex: 1,
                padding: 28,
                borderRadius: radii.panel,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              }}
            >
              {promptFace}
              {flipped ? (
                answerFace
              ) : (
                <Text variant="subtle" style={{ marginTop: "auto", paddingTop: 24 }}>
                  Tap to reveal
                </Text>
              )}
            </View>
          </Pressable>
        )}
        </View>
        {animated && !tipDone && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radii.control, backgroundColor: colors.surfaceSunken }}>
            <Text variant="subtle" style={{ flex: 1 }}>
              Tap to flip · double-tap to hear it · swipe right if you know it, left if not
            </Text>
            <Pressable onPress={() => setTipDone(true)} accessibilityRole="button" accessibilityLabel="Dismiss tip" hitSlop={10}>
              <Icon icon={X} size={16} color={colors.inkMuted} />
            </Pressable>
          </View>
        )}
        <Text variant="subtle" style={{ textAlign: "center" }}>
          <Text
            style={{
              fontSize: 13,
              fontFamily: font.medium,
              color: colors.success,
            }}
          >
            {session.knownCount} known
          </Text>{" "}
          ·{" "}
          <Text
            style={{
              fontSize: 13,
              fontFamily: font.medium,
              color: colors.danger,
            }}
          >
            {session.missedCount} missed
          </Text>
        </Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button
              label="Don’t know"
              icon={<Icon icon={X} size={16} color={colors.danger} />}
              onPress={() => (animated && cardRef.current ? cardRef.current.fling(false) : rate(false))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              kind="primary"
              label="Know"
              icon={<Icon icon={Check} size={16} color={colors.brandInk} />}
              onPress={() => (animated && cardRef.current ? cardRef.current.fling(true) : rate(true))}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
