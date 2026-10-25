import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useApi, useAsync } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { retryText } from "@mdb/client";
import { clock, useListening, useStoryAudio } from "@/lib/listening";
import { font, useTheme } from "@/lib/theme";
import { Pill } from "@/ui/Pill";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Cover } from "@/ui/Cover";
import { Icon } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import type { SeriesChapter, SeriesView, StoryAudioBrief } from "@mdb/shared";
import { Clock, Download, Headphones, Play, ChevronLeft } from "lucide-react-native";

/** A book: what it's about, how far you are, and its chapters (as on the web). */
export default function BookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const { colors, radii } = useTheme();
  const { status } = useSync();
  const book = useAsync(() => api.series(id), [api, id, status.revision], { keep: true });
  const { audio, refresh } = useStoryAudio(api);

  return (
    <Screen>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 }}>
        <Icon icon={ChevronLeft} size={18} color={colors.inkMuted} />
        <Text style={{ fontFamily: font.medium, color: colors.inkMuted }}>Stories</Text>
      </Pressable>
      {book.status === "error" && <Text style={{ color: colors.danger }}>This book isn't here (or isn't yours).</Text>}
      {book.status === "ready" &&
        (() => {
          const b = book.data;
          const started = b.status !== "unread";
          return (
            <>
              <Card style={{ padding: 20, gap: 16, borderRadius: radii.panel }}>
                <View style={{ flexDirection: "row", gap: 16 }}>
                  <Cover kind="series" id={b.id} version={b.cover} fallbackKey={`${b.title}-${b.subtitle ?? ""}-${b.level}`} width={104} />
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text variant="eyebrow">Book</Text>
                    <Text variant="title" style={{ fontSize: 24, lineHeight: 30 }}>
                      {b.title}
                    </Text>
                    {b.subtitle ? <Text variant="muted">{b.subtitle}</Text> : null}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      <Pill text={b.level} />
                      <Pill text={b.written < b.total ? `${b.written} of ${b.total} chapters written` : `${b.total} chapters`} />
                    </View>
                  </View>
                </View>
                {b.description ? <Text variant="muted">{b.description}</Text> : null}
                {b.written > 0 && (
                  <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text variant="muted">
                        {b.read} of {b.total} chapters read
                      </Text>
                      <Text variant="muted">{Math.round(b.progress * 100)}%</Text>
                    </View>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
                      <View style={{ width: `${Math.round(b.progress * 100)}%`, height: "100%", backgroundColor: colors.brand }} />
                    </View>
                    {b.continueId && b.read < b.written && (
                      <View style={{ flexDirection: "row" }}>
                        <Button kind="primary" label={started ? "Continue reading" : "Start reading"} onPress={() => router.push(`/reader/${b.continueId}`)} />
                      </View>
                    )}
                  </View>
                )}
              </Card>

              <AudiobookBox book={b} audio={audio} onChange={refresh} />

              <Text variant="heading">Chapters</Text>
              <Card>
                {b.chapters.map((c, i) => (
                  <Pressable
                    key={c.chapter}
                    disabled={!c.storyId}
                    onPress={() => c.storyId && router.push(`/reader/${c.storyId}`)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: colors.border,
                      backgroundColor: pressed ? colors.surfaceSunken : "transparent",
                    })}
                  >
                    {c.storyId ? (
                      <Cover kind="story" id={c.storyId} version={c.cover} fallbackKey={`${c.title}-${c.level ?? b.level}`} width={36} />
                    ) : (
                      <View style={{ width: 36, aspectRatio: 2 / 3, borderRadius: 6, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong }} />
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontFamily: c.storyId ? font.medium : font.regular, color: c.storyId ? colors.ink : colors.inkSubtle }}>
                        {c.title}
                      </Text>
                      <Text variant="subtle">
                        {c.storyId ? `${c.minutes} min${c.level && c.level !== b.level ? ` · ${c.level}` : ""}` : "Not written yet"}
                      </Text>
                    </View>
                    {c.storyId && <ChapterAudio storyId={c.storyId} title={c.title} book={b.title} audio={audio[c.storyId]} />}
                    {c.status === "read" ? <Pill text="✓ Read" tone="success" /> : c.status === "reading" ? <Pill text={`${Math.round(c.progress * 100)}%`} tone="brand" /> : null}
                  </Pressable>
                ))}
              </Card>
            </>
          );
        })()}
    </Screen>
  );
}

type Written = SeriesChapter & { storyId: string };

/**
 * The book as an audiobook: how many chapters have audio, "Generate
 * audiobook" (only when asked — it queues every chapter in order and uses
 * the voice's free limit as it comes back), play from where you are, and
 * download it all for listening offline.
 */
function AudiobookBox({ book: b, audio, onChange }: { book: SeriesView; audio: Record<string, StoryAudioBrief>; onChange: () => void }) {
  const api = useApi();
  const { controller, state } = useListening();
  const { colors, radii } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const written = b.chapters.filter((c): c is Written => !!c.storyId);
  if (!controller || written.length === 0 || (!state.enabled && !written.some((c) => state.downloaded.includes(c.storyId)))) return null;

  const isReady = (c: Written) => state.downloaded.includes(c.storyId) || audio[c.storyId]?.state === "ready";
  const ready = written.filter(isReady);
  const queued = written.filter((c) => audio[c.storyId]?.state === "building" || audio[c.storyId]?.state === "waiting");
  const failed = written.filter((c) => audio[c.storyId]?.state === "error");
  const waiting = written.map((c) => audio[c.storyId]).find((a) => a?.state === "waiting");
  const missing = written.filter((c) => !isReady(c) && !queued.includes(c));
  const notDownloaded = ready.filter((c) => !state.downloaded.includes(c.storyId));
  const from = written.find((c) => c.storyId === b.continueId && isReady(c)) ?? ready[0];
  const saved = from ? state.positions[from.storyId] : undefined;
  const all = ready.length === written.length;
  const minutes = Math.round(ready.reduce((n, c) => n + (audio[c.storyId]?.duration ?? state.positions[c.storyId]?.duration ?? 0), 0) / 60);

  const explain = all
    ? `All ${written.length} chapters are ready${minutes ? ` · ${minutes} min` : ""}.`
    : waiting
      ? `${waiting.waitReason ?? "Waiting for the voice's limit"}. It carries on by itself${waiting.retryAt ? ` ${retryText(waiting.retryAt)}` : ""}, chapter by chapter; the chapters made already can be played.`
      : queued.length
        ? `Making the audio, chapter by chapter. You can listen to the ready ones already.`
        : failed.length
          ? `${failed.length} chapter${failed.length === 1 ? "" : "s"} couldn't be made. Try again?`
          : ready.length
            ? `${missing.length} chapter${missing.length === 1 ? "" : "s"} still without audio.`
            : "Turn the book into audio to listen in the background, with the screen off.";

  const generate = async () => {
    setBusy("generate");
    try {
      await api.startSeriesAudio(b.id);
      onChange();
    } catch (e) {
      Alert.alert("Couldn't generate the audiobook", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const downloadAll = async () => {
    try {
      for (let i = 0; i < notDownloaded.length; i++) {
        setBusy(`Downloading ${i + 1} of ${notDownloaded.length}…`);
        await controller.download({ id: notDownloaded[i]!.storyId, title: notDownloaded[i]!.title, book: b.title });
      }
    } catch (e) {
      Alert.alert("Couldn't download the audio", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ padding: 16, gap: 12, borderRadius: radii.panel }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon icon={Headphones} size={18} color={colors.brandInk} />
        <Text style={{ fontFamily: font.semibold, flex: 1 }}>Audiobook</Text>
        <Text variant="subtle">
          {ready.length} of {written.length} ready
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
        <View style={{ width: `${Math.round((ready.length / written.length) * 100)}%`, height: "100%", backgroundColor: colors.brand }} />
      </View>
      <Text variant="muted">{explain}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {from && (
          <Button
            kind="primary"
            label={saved && !saved.done && saved.t > 5 ? `Continue · Chapter ${from.chapter}` : `Play from chapter ${from.chapter}`}
            icon={<Icon icon={Play} size={16} />}
            onPress={() => {
              if (state.storyId !== from.storyId) void controller.listen({ id: from.storyId, title: from.title, book: b.title });
              router.push("/player");
            }}
          />
        )}
        {(missing.length > 0 || failed.length > 0) && state.enabled && (
          <Button
            label={busy === "generate" ? "Asking…" : ready.length || queued.length ? `Generate the rest (${missing.length})` : "Generate audiobook"}
            icon={<Icon icon={Headphones} size={16} />}
            disabled={!!busy}
            onPress={() => void generate()}
          />
        )}
        {ready.length > 0 && (
          <Button
            label={busy && busy !== "generate" ? busy : notDownloaded.length === 0 ? "Downloaded" : `Download all (${notDownloaded.length})`}
            icon={<Icon icon={Download} size={16} />}
            disabled={!!busy || notDownloaded.length === 0}
            onPress={() => void downloadAll()}
          />
        )}
      </View>
    </Card>
  );
}

/** A chapter row's audio: play when it's ready, a clock while it's being made. */
function ChapterAudio({ storyId, title, book, audio }: { storyId: string; title: string; book: string; audio: StoryAudioBrief | undefined }) {
  const { controller, state } = useListening();
  const { colors } = useTheme();
  if (!controller) return null;
  const ready = state.downloaded.includes(storyId) || audio?.state === "ready";
  if (audio?.state === "building" || audio?.state === "waiting")
    return <Icon icon={Clock} size={16} color={audio.state === "waiting" ? colors.warning : colors.inkSubtle} />;
  if (!ready) return null;
  const saved = state.positions[storyId];
  return (
    <Pressable
      onPress={() => {
        if (state.storyId !== storyId) void controller.listen({ id: storyId, title, book });
        router.push("/player");
      }}
      accessibilityRole="button"
      accessibilityLabel={`Listen to ${title}${saved && !saved.done && saved.t > 5 ? `, ${clock(saved.duration - saved.t)} left` : ""}`}
      hitSlop={8}
      style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft }}
    >
      <Icon icon={Play} size={14} color={colors.brandInk} fill={colors.brandInk} />
    </Pressable>
  );
}
