import { View } from "react-native";
import { downloadAndInstall } from "@/lib/updates";
import { useUpdateState } from "@/lib/updateStore";
import { font, useTheme } from "@/lib/theme";
import { Button } from "./Button";
import { Card } from "./Card";
import { Text } from "./Text";

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/** On Home when a newer build of the app is out: download it and open the installer. */
export function UpdateCard() {
  const s = useUpdateState();
  const { colors } = useTheme();
  if (s.phase !== "available" && s.phase !== "downloading" && s.phase !== "ready" && !(s.phase === "error" && s.release)) return null;
  const release = s.release!;
  return (
    <Card style={{ padding: 16, gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ fontFamily: font.semibold }}>A new version of the app is out</Text>
        <Text variant="subtle">
          {s.phase === "error" ? `Couldn't update: ${s.message}` : `Build ${release.build} · ${mb(release.size)}`}
        </Text>
      </View>
      {s.phase === "downloading" ? (
        <View accessibilityLabel={`Downloading, ${Math.round(s.progress * 100)}%`} style={{ gap: 6 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
            <View style={{ width: `${Math.round(s.progress * 100)}%`, height: "100%", backgroundColor: colors.brand, borderRadius: 3 }} />
          </View>
          <Text variant="subtle">Downloading… {Math.round(s.progress * 100)}%</Text>
        </View>
      ) : (
        <View style={{ flexDirection: "row" }}>
          <Button
            kind="primary"
            label={s.phase === "ready" ? "Install" : s.phase === "error" ? "Try again" : "Download and install"}
            onPress={() => void downloadAndInstall()}
          />
        </View>
      )}
    </Card>
  );
}
