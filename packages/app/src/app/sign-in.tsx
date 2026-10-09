import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useServer } from "@/lib/server";
import { useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Sign in on the server's own page (a browser tab), then come back. */
export default function SignIn() {
  const { server, signIn, disconnect } = useServer();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen dock={false}>
      <View style={{ gap: 20, paddingTop: 40 }}>
        <Image source={require("../../assets/images/icon.png")} style={{ width: 64, height: 64, borderRadius: 16 }} />
        <View style={{ gap: 6 }}>
          <Text variant="title">Sign in</Text>
          <Text variant="muted">
            You'll sign in on {server?.replace(/^https?:\/\//, "")} and allow this app. Your password stays with your server.
          </Text>
        </View>
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        <Button kind="primary" label="Sign in" onPress={go} busy={busy} />
        <Button kind="ghost" label="Use a different server" onPress={() => void disconnect()} />
      </View>
    </Screen>
  );
}
