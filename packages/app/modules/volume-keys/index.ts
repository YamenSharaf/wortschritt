import { useEffect, useRef } from "react";
import { requireOptionalNativeModule } from "expo";

type Subscription = { remove(): void };
type VolumeKeysModule = {
  setEnabled(enabled: boolean): Promise<void>;
  addListener(event: "onVolumeKey", listener: (e: { key: "up" | "down"; repeat: boolean }) => void): Subscription;
};

/** Android only (android/…/VolumeKeysModule.kt); null elsewhere. */
const native = requireOptionalNativeModule<VolumeKeysModule>("WortschrittVolumeKeys");

export const volumeKeysSupported = native !== null;

/**
 * While `enabled`, the volume keys call `onKey` (a held key counts once) and
 * leave the volume alone; otherwise, and once unmounted, they're the volume.
 */
export function useVolumeKeys(enabled: boolean, onKey: (key: "up" | "down") => void) {
  const handler = useRef(onKey);
  handler.current = onKey;
  useEffect(() => {
    if (!native || !enabled) return;
    const sub = native.addListener("onVolumeKey", (e) => !e.repeat && handler.current(e.key));
    void native.setEnabled(true);
    return () => {
      sub.remove();
      void native.setEnabled(false);
    };
  }, [enabled]);
}
