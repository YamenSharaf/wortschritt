import { Alert, Pressable } from "react-native";
import { Star } from "lucide-react-native";
import type { FavoriteKind } from "@mdb/shared";
import { useFavorites } from "@mdb/client/react";
import { useFeedback } from "@/lib/feedback";
import { useTheme } from "@/lib/theme";
import { Icon } from "./icons";

/** Star or unstar a set or sheet (starred ones are listed first on Home). */
export function StarButton({ kind, id, title }: { kind: FavoriteKind; id: string; title: string }) {
  const { colors } = useTheme();
  const { isFavorite, toggle } = useFavorites();
  const feedback = useFeedback();
  const on = isFavorite(kind, id);
  return (
    <Pressable
      onPress={() => {
        feedback.tick();
        toggle(kind, id).catch((e) => Alert.alert("Couldn't change your favourites", e instanceof Error ? e.message : String(e)));
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={on ? `Remove ${title} from favourites` : `Add ${title} to favourites`}
      hitSlop={10}
      style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", marginTop: -4, marginRight: -6 }}
    >
      <Icon icon={Star} size={20} color={on ? "#e0a800" : colors.inkSubtle} fill={on ? colors.reward1 : undefined} />
    </Pressable>
  );
}
