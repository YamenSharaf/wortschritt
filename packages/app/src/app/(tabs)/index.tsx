import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import type { RunSummary } from "@mdb/shared";
import { timeAgo } from "@mdb/client";
import { useApi, useAsync, useAuth } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Icon, Play, sections } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

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
        <SyncLine />
        <Pressable
          onPress={() => router.push("/account")}
          accessibilityRole="button"
          accessibilityLabel="Account"
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.brandSoft,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontFamily: font.semibold, color: colors.brandInk }}>{(user?.username ?? "?").slice(0, 1).toUpperCase()}</Text>
        </Pressable>
      </View>

      <Card style={{ padding: 24, gap: 10, borderRadius: radii.panel }}>
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
      </Card>

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
    </Screen>
  );
}

/** Where the data on screen stands: synced when, offline, or changes waiting to be sent. */
function SyncLine() {
  const { status } = useSync();
  const { colors } = useTheme();
  const waiting = status.pending > 0 ? ` · ${status.pending} ${status.pending === 1 ? "change" : "changes"} to send` : "";
  const text =
    status.state === "syncing"
      ? "Syncing…"
      : status.state === "offline"
        ? `Offline${status.lastSyncAt ? ` · synced ${timeAgo(Math.floor(status.lastSyncAt / 1000))}` : ""}${waiting}`
        : status.state === "error"
          ? `Couldn't sync${waiting}`
          : status.lastSyncAt
            ? `Synced ${timeAgo(Math.floor(status.lastSyncAt / 1000))}${waiting}`
            : waiting.slice(3);
  return (
    <Text
      variant="subtle"
      numberOfLines={1}
      style={{ flex: 1, color: status.state === "error" ? colors.danger : undefined }}
      accessibilityLiveRegion="polite"
    >
      {text}
    </Text>
  );
}

function RunRow({ run, first }: { run: RunSummary; first: boolean }) {
  const { colors } = useTheme();
  const s = run.kind === "story" ? sections.stories : sections.practice;
  const tierColor = run.tier === "good" ? colors.success : run.tier === "ok" ? colors.warning : run.tier === "weak" ? colors.danger : colors.inkMuted;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      <Icon icon={s.icon} size={18} color={colors[s.tint]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.medium }}>
          {run.setTitle}
        </Text>
        <Text variant="subtle">{timeAgo(run.finishedAt)}</Text>
      </View>
      <Text variant="subtle">
        Last: <Text style={{ fontFamily: font.semibold, fontSize: 13, color: tierColor }}>{`${run.correct}/${run.answered}`}</Text>
      </Text>
    </View>
  );
}
