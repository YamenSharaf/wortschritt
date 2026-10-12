import { View } from "react-native";
import { router } from "expo-router";
import { useFavorites } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { Button } from "@/ui/Button";
import { FavoriteRows, useFavoriteRows } from "@/ui/FavoriteRows";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Every starred set and sheet, newest first ("Show all" on Home). */
export default function Favorites() {
  const rev = useSync().status.revision;
  const favorites = useFavorites({ reloadKey: rev });
  const rows = useFavoriteRows(favorites.list);
  return (
    <Screen dock={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="title">Favourites</Text>
        <Button kind="ghost" label="Done" onPress={() => router.back()} />
      </View>
      {rows === null ? (
        <Text variant="muted">Loading…</Text>
      ) : rows.length === 0 ? (
        <Text variant="muted">Star an exercise set or a cheat sheet to keep it here.</Text>
      ) : (
        <FavoriteRows rows={rows} />
      )}
    </Screen>
  );
}
