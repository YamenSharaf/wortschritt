import { useState, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { SeriesSummary, StorySummary } from "@mdb/shared";
import { preferences } from "@mdb/client";
import { useApi, useAsync, usePreference } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Card } from "@/ui/Card";
import { AudioChip } from "@/listen/AudioChip";
import { useStoryAudio } from "@/lib/listening";
import { Cover } from "@/ui/Cover";
import { Screen } from "@/ui/Screen";
import { Pill } from "@/ui/Pill";
import { Text } from "@/ui/Text";
import { Segmented } from "@/reader/ReaderSheets";

/** Books (a shelf of covers, or a list) and short stories, as on the web; chapters live in their book. */
export default function Stories() {
  const api = useApi();
  const { colors } = useTheme();
  const { status, syncNow } = useSync();
  const stories = useAsync(() => api.stories(), [api, status.revision], { keep: true });
  const books = useAsync(() => api.seriesList(), [api, status.revision], { keep: true });
  const [refreshing, setRefreshing] = useState(false);
  const list = stories.status === "ready" ? stories.data.filter((s) => !s.seriesId) : [];
  const { audio, refresh } = useStoryAudio(api);
  const shelf = books.status === "ready" ? books.data : [];

  return (
    <Screen
      onRefresh={async () => {
        setRefreshing(true);
        await syncNow();
        setRefreshing(false);
      }}
      refreshing={refreshing}
    >
      <Text variant="title">Stories</Text>
      {stories.status === "error" && <Text style={{ color: colors.danger }}>Couldn't load your stories. Pull to try again.</Text>}
      {shelf.length > 0 && <Bookshelf books={shelf} />}
      {shelf.length > 0 && list.length > 0 && <Text variant="heading">Short stories</Text>}
      {list.length > 0 && (
        <Card>
          {list.map((s, i) => (
            <StoryRow key={s.id} story={s} first={i === 0} audio={<AudioChip story={{ id: s.id, title: s.title }} audio={audio[s.id]} onGenerated={refresh} />} />
          ))}
        </Card>
      )}
      {stories.status === "ready" && list.length === 0 && shelf.length === 0 && (
        <Text variant="muted">No stories yet. Generate or write one on the web; it'll be here after the next sync.</Text>
      )}
    </Screen>
  );
}

function Bookshelf({ books }: { books: SeriesSummary[] }) {
  const [view, setView] = usePreference(preferences.shelfView);
  const { width } = useWindowDimensions();
  const cols = width > 700 ? 5 : 3;
  const coverWidth = (Math.min(width, 900) - 40 - 16 * (cols - 1)) / cols;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="heading">Books</Text>
        <Segmented value={view} options={[["covers", "Covers"], ["list", "List"]]} onChange={setView} />
      </View>
      {view === "covers" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          {books.map((b) => (
            <Pressable key={b.id} onPress={() => router.push(`/series/${b.id}`)} accessibilityRole="button" accessibilityLabel={bookLabel(b)}>
              <Cover kind="series" id={b.id} version={b.cover} fallbackKey={`${b.title}-${b.subtitle ?? ""}-${b.level}`} width={coverWidth} />
              <Marker book={b} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Card>
          {books.map((b, i) => (
            <Row
              key={b.id}
              first={i === 0}
              onPress={() => router.push(`/series/${b.id}`)}
              cover={<Cover kind="series" id={b.id} version={b.cover} fallbackKey={`${b.title}-${b.subtitle ?? ""}-${b.level}`} width={48} />}
              title={b.title}
              subtitle={b.subtitle}
              pills={[b.level, `${b.written}${b.total > b.written ? ` of ${b.total}` : ""} chapters`]}
              status={b.status}
              progress={b.progress}
            />
          ))}
        </Card>
      )}
    </View>
  );
}

const bookLabel = (b: SeriesSummary) =>
  `${b.title}${b.status === "read" ? ", read" : b.status === "reading" ? `, ${Math.round(b.progress * 100)}% read` : ""}`;

/** A tick (finished) or a bookmark ribbon (in progress) on a cover. */
function Marker({ book }: { book: SeriesSummary }) {
  const { colors } = useTheme();
  if (book.status === "read")
    return (
      <View
        style={{
          position: "absolute",
          top: -6,
          right: -6,
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: colors.success,
          borderWidth: 2,
          borderColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: colors.surface, fontSize: 12, fontFamily: font.bold }}>✓</Text>
      </View>
    );
  if (book.status === "unread") return null;
  return <View style={{ position: "absolute", top: -6, right: 12, width: 10, height: 26, backgroundColor: colors.reward2 }} />;
}

function StoryRow({ story: s, first, audio }: { story: StorySummary; first: boolean; audio: ReactNode }) {
  return (
    <Row
      first={first}
      onPress={() => router.push(`/reader/${s.id}`)}
      cover={<Cover kind="story" id={s.id} version={s.cover} fallbackKey={`${s.title}-${s.level}`} width={48} />}
      title={s.title}
      subtitle={s.subtitle}
      pills={[s.level, `${s.minutes} min`, ...(s.questions > 0 ? [`${s.questions} ${s.questions === 1 ? "question" : "questions"}`] : [])]}
      status={s.status}
      progress={s.progress}
      extra={audio}
    />
  );
}

function Row({
  first,
  onPress,
  cover,
  title,
  subtitle,
  pills,
  status,
  progress,
  extra,
}: {
  first: boolean;
  onPress: () => void;
  cover: ReactNode;
  title: string;
  subtitle?: string;
  pills: string[];
  status: "unread" | "reading" | "read";
  progress: number;
  /** Under the details (a story's audio). */
  extra?: ReactNode;
}) {
  const { colors, radii } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 14,
        padding: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSunken : "transparent",
      })}
    >
      {cover}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontFamily: font.semibold }}>{title}</Text>
        {subtitle ? <Text variant="muted">{subtitle}</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {pills.map((p) => (
            <Pill key={p} text={p} />
          ))}
          {status === "read" && <Pill text="✓ Read" tone="success" />}
          {status === "reading" && <Pill text={`${Math.round(progress * 100)}% read`} tone="brand" />}
        </View>
        {status === "reading" && (
          <View style={{ height: 3, borderRadius: radii.control, backgroundColor: colors.surfaceSunken, marginTop: 8, overflow: "hidden" }}>
            <View style={{ width: `${Math.round(progress * 100)}%`, height: "100%", backgroundColor: colors.brand }} />
          </View>
        )}
        {extra ? <View style={{ marginTop: 10 }}>{extra}</View> : null}
      </View>
    </Pressable>
  );
}
