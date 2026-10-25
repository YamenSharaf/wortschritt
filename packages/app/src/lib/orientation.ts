import { useEffect } from "react";
import * as ScreenOrientation from "expo-screen-orientation";
import { preferences } from "@mdb/client";
import { usePreference } from "@mdb/client/react";

const LOCKS = {
  auto: ScreenOrientation.OrientationLock.DEFAULT,
  portrait: ScreenOrientation.OrientationLock.PORTRAIT,
  landscape: ScreenOrientation.OrientationLock.LANDSCAPE,
} as const;

/**
 * Holds the screen the way this device's setting says (Account → Appearance),
 * from the start and whenever it changes. On an iPad that keeps Split View
 * and Slide Over, iPadOS may still rotate the app: there the lock is a wish.
 */
export function useOrientationLock() {
  const [choice] = usePreference(preferences.orientation);
  useEffect(() => {
    ScreenOrientation.lockAsync(LOCKS[choice]).catch(() => {});
  }, [choice]);
}
