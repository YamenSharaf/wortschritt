import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import type { RunSummary } from "@mdb/shared";
import { timeAgo } from "@mdb/client";
import { useApi, useAsync, useAuth, useAvatar, useFavorites } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { GlassCard } from "@/ui/GlassCard";
import { IconTile } from "@/ui/IconTile";
import { Icon, Play, sections } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { UpdateCard } from "@/ui/UpdateCard";
import { Avatar } from "@/ui/Avatar";
import { FavoriteRows, useFavoriteRows } from "@/ui/FavoriteRows";
import { Logo } from "@/ui/Logo";
import { RecentReading, useRecentReading } from "@/ui/RecentReading";
import { useLayout } from "@/lib/layout";

/** How many favourites Home lists before "Show all". */
const FAVORITES_ON_HOME = 3;
/** How many stories Home suggests reading on. */
const READING_ON_HOME = 3;

function greeting(): string {
  const h = new Date().getHours();
  return h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
}

/** Home: today's goal and where to continue, as the server computes them. */
export default function Home() {
  const api = useApi();
  const { user } = useAuth();
  const { colors, radii } = useTheme();
  const sync = useSync();
  const [refreshing, setRefreshing] = useState(false);
  // Read from the device; reloaded after each sync (keeping what's shown meanwhile).
  const rev = sync.status.revision;
  const settings = useAsync(() => api.settings(), [api, rev], { keep: true });
  const progress = useAsync(() => api.progress(), [api, rev], { keep: true });
  const runs = useAsync(() => api.runs(5), [api, rev], { keep: true });
  const { avatar } = useAvatar({ reloadKey: rev });
  const favorites = useFavorites({ reloadKey: rev });
  const favoriteRows = useFavoriteRows(favorites.list);
  const syncFailed = sync.status.state === "error";
  const reading = useRecentReading(READING_ON_HOME);
  // A tablet in landscape: today and practice on the left, what to open on the right.
  const { wide } = useLayout();

  const name = (settings.status === "ready" && settings.data.displayName.trim()) || user?.username || "";
  const p = progress.status === "ready" ? progress.data : null;
  const left = p?.goalLeft ?? 0;

  return (
    <Screen
      onRefresh={async () => {
        setRefreshing(true);
        await sync.syncNow();
        setRefreshing(false);
      }}
      refreshing={refreshing}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }} accessibilityRole="header">
          <Logo size={28} />
          <Text style={{ fontFamily: font.semibold, fontSize: 19, letterSpacing: -0.2 }}>Wortschritt</Text>
        </View>
        <Pressable
          onPress={() => router.push("/account")}
          accessibilityRole="button"
          accessibilityLabel={syncFailed ? "Account, couldn't sync" : "Account"}
          hitSlop={6}
          style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
        >
          <Avatar avatar={avatar} size={40} dot={syncFailed ? colors.danger : undefined} />
        </Pressable>
      </View>

      {wide ? (
        <View style={{ flexDirection: "row", gap: 28, alignItems: "flex-start" }}>
          <View style={{ flex: 1.1, minWidth: 0, gap: 16 }}>
              <UpdateCard />

              <GlassCard style={{ padding: 24, gap: 10 }}>
                <Text variant="eyebrow">
                  {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                </Text>
                <Text variant="title" style={{ fontSize: 30, lineHeight: 36 }}>
                  {greeting()}
                  {name ? `, ${name}` : ""}
                </Text>
                {p && (
                  <>
                    <Text variant="muted">
                      {left > 0 ? `${left} ${left === 1 ? "answer" : "answers"} left to reach today's goal.` : "Today's goal is done. Anything more is a bonus."}
                    </Text>
                    <View
                      accessibilityLabel={`Daily goal: ${p.answeredToday} of ${p.dailyGoal} answers`}
                      style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceSunken, overflow: "hidden", marginTop: 4 }}
                    >
                      <View style={{ width: `${p.goalPercent}%`, height: "100%", backgroundColor: colors.reward2, borderRadius: 4 }} />
                    </View>
                    <Text variant="subtle">
                      {p.answeredToday} of {p.dailyGoal} today
                      {p.accuracy !== null ? ` · Accuracy ${p.accuracy}%` : ""} · {p.totalAnswered} answered in total
                    </Text>
                  </>
                )}
                {progress.status === "error" && <Text style={{ color: colors.danger }}>Couldn't load your progress. Pull to try again.</Text>}
                <View style={{ flexDirection: "row", marginTop: 8 }}>
                  <Button
                    kind="primary"
                    label={p?.continue ? "Continue practice" : "Start practising"}
                    icon={<Icon icon={Play} size={16} color={colors.brandInk} />}
                    onPress={() => router.navigate("/practice")}
                  />
                </View>
              </GlassCard>

              {syncFailed && (
                <Pressable onPress={() => void sync.syncNow()} accessibilityRole="button" hitSlop={6} style={{ alignSelf: "center", marginTop: -6 }}>
                  <Text variant="subtle" style={{ color: colors.danger }}>
                    Couldn't sync · <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.brandInk }}>Try again</Text>
                  </Text>
                </Pressable>
              )}

              {runs.status === "ready" && runs.data.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text variant="heading">Recent practice</Text>
                  <Card>
                    {runs.data.map((r, i) => (
                      <RunRow key={r.setId} run={r} first={i === 0} />
                    ))}
                  </Card>
                </View>
              )}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 16 }}>
              {favoriteRows && favoriteRows.length > 0 && (
                <View style={{ gap: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
                    <Text variant="heading">Favourites</Text>
                    {favoriteRows.length > FAVORITES_ON_HOME && (
                      <Pressable onPress={() => router.push("/favorites")} accessibilityRole="button" hitSlop={8}>
                        <Text style={{ fontFamily: font.medium, color: colors.brandInk }}>Show all ({favoriteRows.length})</Text>
                      </Pressable>
                    )}
                  </View>
                  <FavoriteRows rows={favoriteRows.slice(0, FAVORITES_ON_HOME)} />
                </View>
              )}

              {reading && reading.items.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text variant="heading">{reading.reading ? "Continue reading" : "New to read"}</Text>
                  <RecentReading items={reading.items} />
                </View>
              )}
          </View>
        </View>
      ) : (
        <>
              <UpdateCard />

              <GlassCard style={{ padding: 24, gap: 10 }}>
                <Text variant="eyebrow">
                  {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                </Text>
                <Text variant="title" style={{ fontSize: 30, lineHeight: 36 }}>
                  {greeting()}
                  {name ? `, ${name}` : ""}
                </Text>
                {p && (
                  <>
                    <Text variant="muted">
                      {left > 0 ? `${left} ${left === 1 ? "answer" : "answers"} left to reach today's goal.` : "Today's goal is done. Anything more is a bonus."}
                    </Text>
                    <View
                      accessibilityLabel={`Daily goal: ${p.answeredToday} of ${p.dailyGoal} answers`}
                      style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceSunken, overflow: "hidden", marginTop: 4 }}
                    >
                      <View style={{ width: `${p.goalPercent}%`, height: "100%", backgroundColor: colors.reward2, borderRadius: 4 }} />
                    </View>
                    <Text variant="subtle">
                      {p.answeredToday} of {p.dailyGoal} today
                      {p.accuracy !== null ? ` · Accuracy ${p.accuracy}%` : ""} · {p.totalAnswered} answered in total
                    </Text>
                  </>
                )}
                {progress.status === "error" && <Text style={{ color: colors.danger }}>Couldn't load your progress. Pull to try again.</Text>}
                <View style={{ flexDirection: "row", marginTop: 8 }}>
                  <Button
                    kind="primary"
                    label={p?.continue ? "Continue practice" : "Start practising"}
                    icon={<Icon icon={Play} size={16} color={colors.brandInk} />}
                    onPress={() => router.navigate("/practice")}
                  />
                </View>
              </GlassCard>

              {syncFailed && (
                <Pressable onPress={() => void sync.syncNow()} accessibilityRole="button" hitSlop={6} style={{ alignSelf: "center", marginTop: -6 }}>
                  <Text variant="subtle" style={{ color: colors.danger }}>
                    Couldn't sync · <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.brandInk }}>Try again</Text>
                  </Text>
                </Pressable>
              )}

              {favoriteRows && favoriteRows.length > 0 && (
                <View style={{ gap: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
                    <Text variant="heading">Favourites</Text>
                    {favoriteRows.length > FAVORITES_ON_HOME && (
                      <Pressable onPress={() => router.push("/favorites")} accessibilityRole="button" hitSlop={8}>
                        <Text style={{ fontFamily: font.medium, color: colors.brandInk }}>Show all ({favoriteRows.length})</Text>
                      </Pressable>
                    )}
                  </View>
                  <FavoriteRows rows={favoriteRows.slice(0, FAVORITES_ON_HOME)} />
                </View>
              )}

              {reading && reading.items.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text variant="heading">{reading.reading ? "Continue reading" : "New to read"}</Text>
                  <RecentReading items={reading.items} />
                </View>
              )}
              {runs.status === "ready" && runs.data.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text variant="heading">Recent practice</Text>
                  <Card>
                    {runs.data.map((r, i) => (
                      <RunRow key={r.setId} run={r} first={i === 0} />
                    ))}
                  </Card>
                </View>
              )}
        </>
      )}
    </Screen>
  );
}

function RunRow({ run, first }: { run: RunSummary; first: boolean }) {
  const { colors } = useTheme();
  const s = run.kind === "story" ? sections.stories : sections.practice;
  const tierColor = run.tier === "good" ? colors.success : run.tier === "ok" ? colors.warning : run.tier === "weak" ? colors.danger : colors.inkMuted;
  // An exercise set opens to practise again; a story's questions open the story.
  const open = () => (run.kind === "story" ? router.push(`/reader/${run.setId.replace(/^story:/, "")}`) : router.push(`/practice/${run.setId}`));
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${run.setTitle}, last ${run.correct} of ${run.answered}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSunken : "transparent",
      })}
    >
      <IconTile icon={s.icon} color={colors[s.tint]} size={32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.medium }}>
          {run.setTitle}
        </Text>
        <Text variant="subtle">{timeAgo(run.finishedAt)}</Text>
      </View>
      <Text variant="subtle">
        Last: <Text style={{ fontFamily: font.semibold, fontSize: 13, color: tierColor }}>{`${run.correct}/${run.answered}`}</Text>
      </Text>
    </Pressable>
  );
}
