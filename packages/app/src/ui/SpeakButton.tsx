import { Pressable } from "react-native";
import { useSpeech } from "@mdb/client/react";
import { useTheme } from "@/lib/theme";
import { Icon } from "./icons";
import { Volume2 } from "lucide-react-native";

/** Say a German word or sentence (the server's voice when chosen, else the phone's). */
export function SpeakButton({ text, size = 18 }: { text: string; size?: number }) {
  const speech = useSpeech();
  const { colors } = useTheme();
  if (!speech.supported()) return null;
  return (
    <Pressable
      onPress={() => speech.speak(text)}
      accessibilityRole="button"
      accessibilityLabel={`Say “${text}”`}
      hitSlop={8}
      style={{ minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center" }}
    >
      <Icon icon={Volume2} size={size} color={colors.inkMuted} />
    </Pressable>
  );
}
