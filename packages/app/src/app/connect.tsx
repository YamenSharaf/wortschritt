import { useState } from "react";
import { Switch, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useServer } from "@/lib/server";
import { font, useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** First launch: which Wortschritt server to use. */
export default function Connect() {
  const { connect } = useServer();
  const { colors, radii } = useTheme();
  const [address, setAddress] = useState("");
  const [allowHttp, setAllowHttp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await connect(address, { allowHttp });
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
          <Text variant="title">Connect to your server</Text>
          <Text variant="muted">Wortschritt runs on your own server. Enter its address, as you'd open it in a browser.</Text>
        </View>
        <TextInput
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={go}
          placeholder="wortschritt.example.com"
          placeholderTextColor={colors.inkSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          inputMode="url"
          accessibilityLabel="Server address"
          style={{
            minHeight: 48,
            paddingHorizontal: 14,
            borderRadius: radii.control,
            borderWidth: 1,
            borderColor: colors.borderControl,
            backgroundColor: colors.surfaceSunken,
            color: colors.ink,
            fontFamily: font.regular,
            fontSize: 16,
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Switch
            value={allowHttp}
            onValueChange={setAllowHttp}
            accessibilityLabel="Allow http"
            trackColor={{ true: colors.brand, false: colors.borderControl }}
            thumbColor={colors.surface}
          />
          <Text variant="subtle" style={{ flex: 1 }}>
            Allow http (only for a server on your own network)
          </Text>
        </View>
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        <Button kind="primary" label="Connect" onPress={go} busy={busy} disabled={!address.trim()} />
      </View>
    </Screen>
  );
}
