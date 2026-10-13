import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useApi, useAsync } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { useListening } from "@/lib/listening";
import { font, useTheme } from "@/lib/theme";
import { Pill } from "@/ui/Pill";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Cover } from "@/ui/Cover";
import { Icon } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { ChevronLeft, Download, Headphones } from "lucide-react-native";

/** A book: what it's about, how far you are, and its chapters (as on the web). */
export default function BookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const { colors, radii } = useTheme();
  const { status } = useSync();
  const book = useAsync(() => api.series(id), [api, id, status.revision], { keep: true });
  const { controller: listening, state: ls } = useListening();
  const [downloading, setDownloading] = useState<{ done: number; total: number } | null>(null);

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
                    {listening && (ls.enabled || b.chapters.some((c) => c.storyId && ls.downloaded.includes(c.storyId))) && (() => {
                      const written = b.chapters.filter((c): c is typeof c & { storyId: string } => !!c.storyId);
                      const missing = written.filter((c) => !ls.downloaded.includes(c.storyId));
                      const from = written.find((c) => c.storyId === b.continueId) ?? written[0];
                      return (
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          {from && (
                            <Button
                              label="Listen"
                              icon={<Icon icon={Headphones} size={16} />}
                              onPress={() => {
                                void listening.listen({ id: from.storyId, title: from.title, book: b.title }, 0);
                                router.push(`/reader/${from.storyId}`);
                              }}
                            />
                          )}
                          <Button
                            label={
                              downloading
                                ? `Downloading ${downloading.done + 1} of ${downloading.total}…`
                                : missing.length === 0
                                  ? "Downloaded for listening"
                                  : `Download for listening (${missing.length})`
                            }
                            icon={<Icon icon={Download} size={16} />}
                            disabled={!!downloading || missing.length === 0}
                            onPress={async () => {
                              try {
                                for (let i = 0; i < missing.length; i++) {
                                  setDownloading({ done: i, total: missing.length });
                                  await listening.download({ id: missing[i]!.storyId, title: missing[i]!.title, book: b.title });
                                }
                              } catch (e) {
                                Alert.alert("Couldn't download the audio", e instanceof Error ? e.message : String(e));
                              } finally {
                                setDownloading(null);
                              }
                            }}
                          />
                        </View>
                      );
                    })()}
                  </View>
                )}
              </Card>

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
