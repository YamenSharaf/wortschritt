import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackHandler, Platform, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useFonts } from "expo-font";
import { useKeepAwake } from "expo-keep-awake";
import { NavigationBar } from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AtkinsonHyperlegible_400Regular } from "@expo-google-fonts/atkinson-hyperlegible/400Regular";
import { AtkinsonHyperlegible_700Bold } from "@expo-google-fonts/atkinson-hyperlegible/700Bold";
import { Lato_400Regular } from "@expo-google-fonts/lato/400Regular";
import { Lato_700Bold } from "@expo-google-fonts/lato/700Bold";
import { Literata_400Regular } from "@expo-google-fonts/literata/400Regular";
import { Literata_600SemiBold } from "@expo-google-fonts/literata/600SemiBold";
import { preferences } from "@mdb/client";
import {
  isSavedWord,
  useAssistantEnabled,
  useReadAloud,
  usePreference,
  useReaderSettings,
  useReadingProgress,
  useStory,
  useStoryLemmas,
  useStoryTranslations,
  useVocabState,
} from "@mdb/client/react";
import { font, useTheme } from "@/lib/theme";
import { storyPieces } from "@/reader/pieces";
import { GlossaryPanel, SettingsPanel, Sheet } from "@/reader/ReaderSheets";
import { RNReader, type ReaderControls } from "@/reader/RNReader";
import { LINE_HEIGHTS, READER_FONTS, WIDTHS, readerColors, type ReaderColors } from "@/reader/style";
import { StoryQuiz } from "@/reader/StoryQuiz";
import { WordSheet } from "@/reader/WordSheet";
import { DownloadRow, ListenBar } from "@/reader/Listen";
import { useListening } from "@/lib/listening";
import { Icon } from "@/ui/icons";
import { Text } from "@/ui/Text";
import { useLayout } from "@/lib/layout";
import { BookOpenText, Check, ChevronLeft, ChevronRight, Headphones, Languages, Pause, Square, Type, Volume2 } from "lucide-react-native";
import { useVolumeKeys, volumeKeysSupported } from "../../../modules/volume-keys";

/** One reader per story, so the next chapter starts fresh. */
export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Reader key={id} id={id} />;
}

/**
 * A story: pages (or one scroll), full screen, the screen kept on. Tapping a
 * word looks it up; the outer quarters, swipes (and the volume keys, if on)
 * turn the page; the middle shows or hides the bars. Text settings are the
 * account's (as on the web); the reading position goes to the server.
 */
function Reader({ id }: { id: string }) {
  useKeepAwake();
  const [fontsLoaded] = useFonts({
    Literata_400Regular,
    Literata_600SemiBold,
    Lato_400Regular,
    Lato_700Bold,
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
    "Libron-Regular": require("../../../assets/fonts/libron/Libron-Regular.ttf"),
    "Libron-Bold": require("../../../assets/fonts/libron/Libron-Bold.ttf"),
  });
  const { view, error, markRead, readAgain, nextChapter, showRead } = useStory(id);
  const { reader, change } = useReaderSettings();
  const aiEnabled = useAssistantEnabled();
  const tr = useStoryTranslations({ storyId: view?.story.id, enabled: aiEnabled });
  const reading = useReadingProgress(view);
  const vocab = useVocabState();
  const lemmas = useStoryLemmas(view?.story.body);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [fullscreen, setFullscreen] = usePreference(preferences.readerFullscreen);
  const [volumeKeys, setVolumeKeys] = usePreference(preferences.volumeKeys);
  const [volumeInvert, setVolumeInvert] = usePreference(preferences.volumeKeysInvert);
  const [tapToTurn, setTapToTurn] = usePreference(preferences.tapToTurn);

  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<"settings" | "glossary" | null>(null);
  const [word, setWord] = useState<{ word: string; context: string } | null>(null);
  const [where, setWhere] = useState<{ page: number; count: number } | null>(null);
  // A tablet in landscape reads like an open book: two pages at a time.
  const spread = useLayout().wide && reader.layout === "pages";
  /** Bumped by "Read again": the text starts over at the top. */
  const [round, setRound] = useState(0);
  const controls = useRef<ReaderControls>(null);
  const aloud = useReadAloud();
  // Listening (a server reading voice): one audio file, the app-wide player.
  const { controller: listening, state: ls } = useListening();
  // Volume down is the next page (up with "invert"); only on pages, with nothing open on top.
  useVolumeKeys(volumeKeys && reader.layout === "pages" && !sheet && !word, (key) =>
    controls.current?.turn((key === "down") !== volumeInvert ? 1 : -1),
  );

  const colors = readerColors(reader.theme, theme.display, theme.scheme);
  const typo = useMemo(
    () => ({
      regular: READER_FONTS[reader.font].regular,
      title: READER_FONTS[reader.font].title,
      ui: font.regular,
      size: reader.size,
      lineHeight: LINE_HEIGHTS[reader.lineHeight],
      maxWidth: WIDTHS[reader.width],
    }),
    [reader.font, reader.size, reader.lineHeight, reader.width],
  );
  const pieces = useMemo(
    () =>
      view
        ? storyPieces({ view, translations: reader.translations, lines: tr.lines, translating: tr.translating, revealed: tr.revealed })
        : [],
    [view, reader.translations, tr.lines, tr.translating, tr.revealed],
  );
  // Each paragraph's German, for reading aloud (English lines left out).
  const paragraphs = useMemo(() => {
    const out: string[] = [];
    for (const x of pieces) if (x.kind === "de" && x.para >= 0) out[x.para] = out[x.para] ? `${out[x.para]} ${x.text}` : x.text;
    return Array.from(out, (t) => t ?? "");
  }, [pieces]);
  const storyId = view?.story.id ?? id;
  const canListen = !!listening && (ls.enabled || ls.downloaded.includes(storyId));
  const listeningHere = ls.storyId === storyId && ls.phase !== "idle";
  const readAloud = () => {
    if (canListen && listening && view) {
      if (listeningHere) return ls.phase === "playing" ? listening.pause() : ls.phase === "paused" ? listening.resume() : undefined;
      aloud.stop();
      return void listening.listen({ id: view.story.id, title: view.story.title, book: view.series?.title ?? null }, controls.current?.firstPara() ?? 0);
    }
    if (aloud.speaking !== null) return aloud.stop();
    aloud.read(paragraphs, controls.current?.firstPara() ?? 0, { rate: reader.speechRate, onParagraph: (i) => controls.current?.showPara(i) });
  };
  // Follow the paragraph being listened to.
  useEffect(() => {
    if (listeningHere && ls.phase === "playing") controls.current?.showPara(ls.paragraph);
  }, [listeningHere, ls.phase, ls.paragraph]);
  // The player went on to the next chapter: so does the reader.
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && ls.storyId && ls.storyId !== storyId && ls.storyId === view?.series?.next) router.replace(`/reader/${ls.storyId}`);
    wasListening.current = ls.storyId === storyId;
  }, [ls.storyId, storyId, view?.series?.next]);
  const isSaved = useCallback((w: string) => isSavedWord(w, vocab.words, lemmas), [vocab.words, lemmas]);
  const { request } = tr;
  const onVisible = useCallback((paras: number[]) => reader.translations !== "off" && request(paras), [reader.translations, request]);

  // Back closes a sheet before leaving the reader.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (word) return setWord(null), true;
      if (sheet) return setSheet(null), true;
      return false;
    });
    return () => sub.remove();
  }, [sheet, word]);

  const book = view?.series ?? null;
  const showBars = chrome || sheet !== null;

  if (error || !view || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: error ? theme.colors.danger : colors.muted, textAlign: "center" }}>{error ?? "Loading…"}</Text>
        {error && <BarButton label="Stories" icon={ChevronLeft} color={colors.fg} onPress={() => router.back()} />}
      </View>
    );
  }
  const story = view.story;

  const ending = (
    <Ending
      colors={colors}
      read={view.readAt !== null}
      book={book}
      quiz={story.questions.length > 0 ? <StoryQuiz story={story} colors={colors} /> : null}
      onFinished={() => void markRead()}
      onReadAgain={async () => {
        await readAgain();
        reading.reset();
        setRound((r) => r + 1);
      }}
      onNext={async () => {
        const next = await nextChapter();
        if (next) router.replace(`/reader/${next}`);
      }}
      onPrevious={() => book?.prev && router.replace(`/reader/${book.prev}`)}
      onBook={() => router.back()}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Immersive: the system bars stay away (a swipe from the edge shows them for a moment). */}
      <StatusBar hidden={fullscreen} style={isLight(colors.bg) ? "dark" : "light"} />
      {Platform.OS === "android" && <NavigationBar hidden={fullscreen} />}

      {/* The safe area (camera cutout, gesture bar) stays clear in full screen too. */}
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flex: 1, paddingTop: reader.layout === "pages" ? 44 : 0, paddingBottom: reader.layout === "pages" ? 32 : 0 }}>
          <RNReader
            key={`${round}-${reader.layout}`}
            ref={controls}
            pieces={pieces}
            mode={reader.layout}
            typo={typo}
            colors={colors}
            isSaved={reader.highlightVocab ? isSaved : undefined}
            resumeAt={round > 0 ? null : view.resumeAt}
            ending={ending}
            onWord={(w, context) => setWord({ word: w, context })}
            onReveal={tr.reveal}
            onProgress={reading.see}
            onVisible={onVisible}
            onCenter={() => setChrome((c) => !c)}
            speaking={listeningHere ? ls.paragraph : aloud.speaking}
            animated={theme.motion.base > 0}
            tapToTurn={tapToTurn}
            spread={spread}
            onPage={(page, count) => {
              setWhere({ page, count });
              setChrome(false);
            }}
          />
        </View>
      </View>

        {/* Pages: the margins above and below the text show or hide the bars too. */}
        {reader.layout === "pages" && (
          <>
            <Pressable
              onPress={() => setChrome((c) => !c)}
              accessible={false}
              style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top + 44 }}
            />
            <Pressable
              onPress={() => setChrome((c) => !c)}
              accessible={false}
              style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: insets.bottom + 32 }}
            />
          </>
        )}

        {/* The bar: back, English lines, glossary, text settings. */}
        {showBars && (
          <View
            style={{
              position: "absolute",
              top: insets.top,
              left: 0,
              right: 0,
              height: 52,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 8,
              gap: 4,
              backgroundColor: colors.bg,
              borderBottomWidth: 1,
              borderBottomColor: colors.rule,
            }}
          >
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={book ? `Back to ${book.title}` : "Back to stories"}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, flex: 1, minHeight: 44, paddingHorizontal: 6 }}
            >
              <Icon icon={ChevronLeft} size={20} color={colors.muted} />
              <Text numberOfLines={1} style={{ fontFamily: font.medium, color: colors.muted, flexShrink: 1 }}>
                {book ? book.title : "Stories"}
              </Text>
            </Pressable>
            {(aiEnabled || tr.hasAny) && (
              <BarButton
                icon={Languages}
                color={reader.translations === "off" ? colors.muted : colors.fg}
                label={reader.translations === "peek" ? "Peek" : reader.translations === "always" ? "On" : undefined}
                a11y={`English line by line: ${reader.translations}`}
                onPress={() => {
                  tr.clearError();
                  change({ translations: reader.translations === "off" ? "peek" : reader.translations === "peek" ? "always" : "off" });
                }}
              />
            )}
            {canListen ? (
              <BarButton
                icon={listeningHere && ls.phase === "playing" ? Pause : Headphones}
                color={listeningHere ? colors.fg : colors.muted}
                a11y={listeningHere && ls.phase === "playing" ? "Pause listening" : "Listen from here"}
                onPress={readAloud}
              />
            ) : (
              aloud.supported && (
                <BarButton
                  icon={aloud.speaking !== null ? Square : Volume2}
                  color={aloud.speaking !== null ? colors.fg : colors.muted}
                  a11y={aloud.speaking !== null ? "Stop reading aloud" : "Read aloud from here"}
                  onPress={readAloud}
                />
              )
            )}
            {story.glossary.length > 0 && <BarButton icon={BookOpenText} color={colors.muted} a11y="Glossary" onPress={() => setSheet("glossary")} />}
            <BarButton icon={Type} color={colors.muted} a11y="Text settings" onPress={() => setSheet("settings")} />
          </View>
        )}
        {reader.translations !== "off" && tr.error && (
          <Pressable
            onPress={tr.clearError}
            style={{ position: "absolute", top: insets.top + 56, left: 16, right: 16, padding: 12, borderRadius: 12, backgroundColor: theme.colors.warningSoft }}
          >
            <Text style={{ color: theme.colors.warning }}>{tr.error} Tap to try again.</Text>
          </Pressable>
        )}

        {/* Where you are (pages). */}
        {reader.layout === "pages" && where && (
          <View
            pointerEvents="none"
            style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 4, height: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}
          >
            <Text style={{ fontFamily: font.mono, fontSize: 12, color: colors.muted }}>
              {where.page >= where.count
                ? "End"
                : spread && where.page + 2 <= where.count
                  ? `${where.page + 1}–${where.page + 2} / ${where.count}`
                  : `${where.page + 1} / ${where.count}`}
            </Text>
            <View style={{ width: 72, height: 2, borderRadius: 1, backgroundColor: colors.rule, overflow: "hidden" }}>
              <View style={{ width: `${Math.round((Math.min(where.page + (spread ? 2 : 1), where.count) / where.count) * 100)}%`, height: "100%", backgroundColor: colors.mark }} />
            </View>
          </View>
        )}

      {sheet === "settings" && (
        <Sheet title="Text" onClose={() => setSheet(null)}>
          <SettingsPanel
            value={reader}
            onChange={change}
            canTranslate={aiEnabled || tr.hasAny}
            canSpeak={aloud.supported}
            device={{
              fullscreen,
              setFullscreen,
              tapToTurn: { on: tapToTurn, set: setTapToTurn },
              volumeKeys: volumeKeysSupported ? { on: volumeKeys, set: setVolumeKeys, invert: volumeInvert, setInvert: setVolumeInvert } : null,
            }}
          />
          {canListen && listening && (
            <DownloadRow state={ls} controller={listening} story={{ id: story.id, title: story.title, book: book?.title ?? null }} colors={{ fg: theme.colors.ink, muted: theme.colors.inkMuted }} />
          )}
        </Sheet>
      )}
      {listeningHere && listening && (
        <ListenBar
          state={ls}
          controller={listening}
          story={{ id: story.id, title: story.title, book: book?.title ?? null }}
          paragraphs={paragraphs.length}
          colors={colors}
          bottom={insets.bottom + (reader.layout === "pages" ? 28 : 0)}
        />
      )}
      {sheet === "glossary" && (
        <Sheet title="Glossary" onClose={() => setSheet(null)}>
          <GlossaryPanel entries={story.glossary} />
        </Sheet>
      )}
      {word && <WordSheet word={word.word} context={word.context} vocab={vocab} onClose={() => setWord(null)} />}
    </View>
  );
}

/** Whether a "#rrggbb" background wants dark status-bar icons. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1, 7), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
}

function BarButton({
  icon,
  label,
  a11y,
  color,
  onPress,
}: {
  icon: Parameters<typeof Icon>[0]["icon"];
  label?: string;
  a11y?: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      hitSlop={4}
      style={{ minWidth: 44, minHeight: 44, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}
    >
      <Icon icon={icon} size={20} color={color} />
      {label ? <Text style={{ fontFamily: font.medium, fontSize: 13, color }}>{label}</Text> : null}
    </Pressable>
  );
}

/** After the last page: finished (or read), and the book's previous / next chapter. */
function Ending({
  colors,
  read,
  book,
  quiz,
  onFinished,
  onReadAgain,
  onNext,
  onPrevious,
  onBook,
}: {
  colors: ReaderColors;
  read: boolean;
  book: { chapter: number; total: number; prev: string | null; next: string | null } | null;
  /** The story's questions (in the end page's scroll). */
  quiz: ReactNode;
  onFinished: () => void;
  onReadAgain: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onBook: () => void;
}) {
  const t = useTheme();
  const link = { fontFamily: font.medium, color: colors.muted, textDecorationLine: "underline" as const };
  return (
    <View style={{ gap: 20 }}>
      <Text style={{ textAlign: "center", color: colors.muted, fontSize: 13 }}>
        — End of {book ? `chapter ${book.chapter}` : "the story"} —
      </Text>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.rule, paddingTop: 16, gap: 14 }}>
        {read ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon icon={Check} size={18} color={t.colors.success} />
              <Text style={{ fontFamily: font.medium, color: t.colors.success }}>You've read this</Text>
            </View>
            <Pressable onPress={onReadAgain} accessibilityRole="button" hitSlop={8}>
              <Text style={link}>Read again</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={onFinished}
            accessibilityRole="button"
            style={{
              alignSelf: "flex-start",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              minHeight: 44,
              paddingHorizontal: 16,
              borderRadius: t.radii.control,
              borderWidth: 1,
              borderColor: colors.rule,
            }}
          >
            <Icon icon={Check} size={18} color={colors.fg} />
            <Text style={{ fontFamily: font.semibold, color: colors.fg }}>Finished reading</Text>
          </Pressable>
        )}
        {book && (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            {book.prev ? (
              <Pressable onPress={onPrevious} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 }}>
                <Icon icon={ChevronLeft} size={18} color={colors.muted} />
                <Text style={{ fontFamily: font.medium, color: colors.muted }}>Previous</Text>
              </Pressable>
            ) : (
              <View />
            )}
            {book.next ? (
              <Pressable
                onPress={onNext}
                accessibilityRole="button"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 44,
                  paddingHorizontal: 16,
                  borderRadius: t.radii.control,
                  backgroundColor: t.colors.brandSoft,
                }}
              >
                <Text style={{ fontFamily: font.semibold, color: t.colors.brandInk }}>Next chapter</Text>
                <Icon icon={ChevronRight} size={18} color={t.colors.brandInk} />
              </Pressable>
            ) : (
              <Pressable onPress={onBook} accessibilityRole="button" hitSlop={8}>
                <Text style={link}>{book.chapter < book.total ? "More chapters coming" : "Back to the book"}</Text>
              </Pressable>
            )}
          </View>
        )}
        {quiz}
      </View>
    </View>
  );
}
