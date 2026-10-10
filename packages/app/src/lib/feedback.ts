import { useCallback } from "react";
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { preferences } from "@mdb/client";
import { usePreference } from "@mdb/client/react";

/**
 * How a right or wrong answer feels: a chime (or a soft low tone) and a
 * haptic tap, each as this device's settings say. The sounds are the app's
 * own (assets/sounds, made for it). Swipes get a light tick.
 */

let players: { correct: AudioPlayer; wrong: AudioPlayer } | null = null;
function sounds() {
  players ??= {
    correct: createAudioPlayer(require("../../assets/sounds/correct.wav")),
    wrong: createAudioPlayer(require("../../assets/sounds/wrong.wav")),
  };
  return players;
}

function play(p: AudioPlayer) {
  try {
    p.seekTo(0);
    p.play();
  } catch {}
}

const haptic = Platform.OS !== "web";

export function useFeedback() {
  const [soundOn] = usePreference(preferences.feedbackSounds);
  const [hapticsOn] = usePreference(preferences.haptics);
  const answer = useCallback(
    (correct: boolean) => {
      if (soundOn) play(correct ? sounds().correct : sounds().wrong);
      if (hapticsOn && haptic)
        void Haptics.notificationAsync(correct ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
    },
    [soundOn, hapticsOn],
  );
  const tick = useCallback(() => {
    if (hapticsOn && haptic) void Haptics.selectionAsync().catch(() => {});
  }, [hapticsOn]);
  return { answer, tick };
}
