import { View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useServer } from "@/lib/server";
import { Button } from "./Button";
import { Card } from "./Card";
import { Screen } from "./Screen";
import { Text } from "./Text";

/** A section the app doesn't have yet: says so, and opens it on the web meanwhile. */
export function Soon({ title, path }: { title: string; path: string }) {
  const { server } = useServer();
  return (
    <Screen>
      <Text variant="title">{title}</Text>
      <Card style={{ padding: 20, gap: 12 }}>
        <Text variant="muted">This section is coming to the app soon. Until then it's on the web.</Text>
        <View style={{ alignSelf: "flex-start" }}>
          <Button label="Open on the web" onPress={() => server && void WebBrowser.openBrowserAsync(server + path)} />
        </View>
      </Card>
    </Screen>
  );
}
