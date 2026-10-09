import { useEffect, useRef, useState } from "react";
import { getDeviceSettings, onDeviceSettings, pushBackHandler, type DeviceSettings } from "./device";

/** While `open`, the Android back button calls `close` (a sheet or popup) instead of going back. */
export function useBackClose(open: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => (open ? pushBackHandler(() => latest.current()) : undefined), [open]);
}

/** This device's own settings (page keys …), updated when they change. */
export function useDeviceSettings(): DeviceSettings {
  const [s, setS] = useState(getDeviceSettings);
  useEffect(() => onDeviceSettings(setS), []);
  return s;
}
