import { Alert, Platform, Pressable, Switch, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { preferences, type Preference } from "@mdb/client";
import { useAuth, useAvatar, usePreference } from "@mdb/client/react";
import { useServer } from "@/lib/server";
import { font, useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Icon, LogOut } from "@/ui/icons";
import { Shuffle } from "lucide-react-native";
import { Avatar } from "@/ui/Avatar";
import { SyncLine } from "@/ui/SyncLine";
import { Segmented } from "@/reader/ReaderSheets";
import { useSync } from "@/lib/sync";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { LearningSettings } from "@/settings/Learning";
import { checkForUpdate, currentBuild, updatesSupported } from "@/lib/updates";
import { useUpdateState } from "@/lib/updateStore";

/** Screen rotation on this device: as it turns, or held upright or sideways. */
function Rotation() {
  const [choice, setChoice] = usePreference(preferences.orientation);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: font.medium }}>Screen rotation</Text>
      <Segmented
        value={choice}
        options={[
          ["auto", "Follow the device"],
          ["portrait", "Portrait"],
          ["landscape", "Landscape"],
        ]}
        onChange={setChoice}
      />
      {Platform.OS === "ios" && <Text variant="subtle">On an iPad, iPadOS may still turn the app (it keeps Split View working).</Text>}
    </View>
  );
}

/** The account sheet: who and where you are, how the app looks on this device, sign out. */
export default function Account() {
  const { user } = useAuth();
  const { server, signOut, disconnect } = useServer();
  const theme = useTheme();
  const { colors, radii } = theme;

  return (
    <Screen dock={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="title">Account</Text>
        <Button kind="ghost" label="Done" onPress={() => router.back()} />
      </View>
      <AccountCard username={user?.username ?? ""} server={server?.replace(/^https?:\/\//, "") ?? ""} />

      <View style={{ gap: 10 }}>
        <Text variant="heading">Learning</Text>
        <Text variant="subtle">For your account, on every device.</Text>
        <LearningSettings />
      </View>

      <View style={{ gap: 10 }}>
        <Text variant="heading">Reading aloud</Text>
        <Card>
          <LinkRow label="Voices, audiobooks and your voice keys" onPress={() => router.push("/reading-aloud")} first />
        </Card>
      </View>

      <View style={{ gap: 10 }}>
        <Text variant="heading">Appearance</Text>
        <Text variant="subtle">On this device only.</Text>
        <Card style={{ padding: 16, gap: 16 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ fontFamily: font.medium }}>Theme</Text>
            <View style={{ flexDirection: "row", gap: 4, padding: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.tabsTrack, alignSelf: "flex-start" }}>
              {(
                [
                  ["system", "Like the device"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ] as const
              ).map(([v, label]) => {
                const on = theme.schemeChoice === v;
                return (
                  <Pressable
                    key={v}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => theme.setScheme(v)}
                    style={{
                      minHeight: 36,
                      paddingHorizontal: 12,
                      justifyContent: "center",
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: on ? colors.tabsActiveBorder : "transparent",
                      backgroundColor: on ? colors.tabsActiveTo : "transparent",
                    }}
                  >
                    <Text style={{ fontFamily: font.medium, fontSize: 13, color: on ? colors.ink : colors.inkMuted }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Rotation />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: font.medium }}>E-ink display</Text>
              <Text variant="subtle">For e-readers: black and white, no animations, nothing see-through. Works with light and dark.</Text>
            </View>
            <Switch
              value={theme.display === "eink"}
              onValueChange={(on) => theme.setDisplay(on ? "eink" : "standard")}
              accessibilityLabel="E-ink display"
              trackColor={{ true: colors.brand, false: colors.borderControl }}
              thumbColor={colors.surface}
            />
          </View>
        </Card>
      </View>

      <View style={{ gap: 10 }}>
        <Text variant="heading">Practice</Text>
        <Text variant="subtle">On this device only.</Text>
        <Card style={{ padding: 16, gap: 8 }}>
          <PrefSwitch pref={preferences.autoAdvance} label="Move on after a right answer" hint="Wrong answers always wait, so you can read the answer or ask the tutor." />
          <PrefSwitch pref={preferences.feedbackSounds} label="Sounds" hint="A chime when you're right, a soft tone when you're not." />
          <PrefSwitch pref={preferences.haptics} label="Vibration" hint="A short tap for answers and swipes." />
        </Card>
      </View>

      {updatesSupported && <AppUpdates />}

      <View style={{ gap: 10 }}>
        <Text variant="heading">More</Text>
        <Card>
          <LinkRow label="Import content" onPress={() => router.push("/import")} first />
          <LinkRow label="Open-source licences" onPress={() => router.push("/licenses")} />
          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text variant="subtle">
              About AI: the tutor's answers, AI translations, generated stories and “Generate more” questions are written by an AI model and can be wrong.
              Stories and sets may also have been written with AI.
            </Text>
          </View>
          <LinkRow
            label="Password, AI tutor, connected apps (web)"
            onPress={() => server && void WebBrowser.openBrowserAsync(`${server}/settings`)}
          />
        </Card>
      </View>

      <View style={{ gap: 10, borderRadius: radii.card }}>
        <Button kind="secondary" label="Sign out" icon={<Icon icon={LogOut} size={16} />} onPress={() => void signOut()} />
        <Button
          kind="ghost"
          label="Use a different server"
          onPress={() =>
            Alert.alert("Use a different server?", "You'll be signed out of this one.", [
              { text: "Cancel", style: "cancel" },
              { text: "Sign out", style: "destructive", onPress: () => void disconnect() },
            ])
          }
        />
      </View>
    </Screen>
  );
}

function LinkRow({ label, onPress, first }: { label: string; onPress: () => void; first?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: 48,
        justifyContent: "center",
        paddingHorizontal: 16,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSunken : "transparent",
      })}
    >
      <Text style={{ fontFamily: font.medium }}>{label} ›</Text>
    </Pressable>
  );
}

function PrefSwitch({ pref, label, hint }: { pref: Preference<boolean>; label: string; hint?: string }) {
  const [on, set] = usePreference(pref);
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.medium }}>{label}</Text>
        {hint ? <Text variant="subtle">{hint}</Text> : null}
      </View>
      <Switch value={on} onValueChange={set} accessibilityLabel={label} trackColor={{ true: colors.brand, false: colors.borderControl }} thumbColor={colors.surface} />
    </View>
  );
}

/** This build, and looking for a newer one (the card on Home downloads and installs it). */
function AppUpdates() {
  const s = useUpdateState();
  const line =
    s.phase === "checking"
      ? "Looking for a new version…"
      : s.phase === "current"
        ? "This is the newest version."
        : s.phase === "available" || s.phase === "ready"
          ? `Build ${s.release.build} is out: see Home to install it.`
          : s.phase === "downloading"
            ? `Downloading build ${s.release.build}… ${Math.round(s.progress * 100)}%`
            : s.phase === "error"
              ? `Couldn't check: ${s.message}`
              : null;
  return (
    <View style={{ gap: 10 }}>
      <Text variant="heading">App</Text>
      <Card style={{ padding: 16, gap: 12 }}>
        <View style={{ gap: 2 }}>
          <Text style={{ fontFamily: font.medium }}>Build {currentBuild()}</Text>
          {line ? <Text variant="subtle">{line}</Text> : null}
        </View>
        <PrefSwitch pref={preferences.autoUpdate} label="Look for updates when the app opens" hint="New versions come from the app's GitHub releases." />
        <View style={{ flexDirection: "row" }}>
          <Button label="Check now" busy={s.phase === "checking"} disabled={s.phase === "downloading"} onPress={() => void checkForUpdate()} />
        </View>
      </Card>
    </View>
  );
}

/** Who and where you are, your icon (pattern or letter, shuffle) and how sync stands. */
function AccountCard({ username, server }: { username: string; server: string }) {
  const { colors } = useTheme();
  const sync = useSync();
  const { avatar, style, setStyle, shuffle } = useAvatar();
  const fail = (e: unknown) => Alert.alert("Couldn't change your icon", e instanceof Error ? e.message : String(e));
  return (
    <Card style={{ padding: 16, gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Avatar avatar={avatar} size={56} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ fontFamily: font.semibold }}>{username}</Text>
          <Text variant="subtle" numberOfLines={1}>
            {server}
          </Text>
          <Pressable onPress={() => void sync.syncNow()} accessibilityRole="button" accessibilityLabel="Sync now" hitSlop={6}>
            <SyncLine />
          </Pressable>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
        <Text style={{ fontFamily: font.medium, flex: 1 }}>Icon</Text>
        <Segmented
          value={style}
          options={[
            ["pattern", "Pattern"],
            ["letter", "Letter"],
          ]}
          onChange={(v) => void setStyle(v).catch(fail)}
          compact
        />
        <Pressable
          onPress={() => void shuffle().catch(fail)}
          accessibilityRole="button"
          accessibilityLabel="Shuffle your pattern"
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
        >
          <Icon icon={Shuffle} size={18} color={colors.inkMuted} />
        </Pressable>
      </View>
    </Card>
  );
}
