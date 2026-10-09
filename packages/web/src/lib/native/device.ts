/**
 * The native side of ../device: Capacitor's SystemBars, and the app's own
 * plugin (packages/android … WortschrittPlugin.java) for keep-awake and the
 * volume keys, which Android otherwise keeps for the volume.
 */
import { App } from "@capacitor/app";
import { registerPlugin, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type { PluginListenerHandle } from "@capacitor/core";
import { closeTopSheet, hydrateDeviceSettings, type PageKey } from "../device";

interface WortschrittPlugin {
  setKeepAwake(options: { on: boolean }): Promise<void>;
  setPageKeys(options: { on: boolean }): Promise<void>;
  addListener(event: "pageKey", listener: (e: { key: PageKey }) => void): Promise<PluginListenerHandle>;
}
const Wortschritt = registerPlugin<WortschrittPlugin>("Wortschritt");

export async function setBarsVisible(visible: boolean): Promise<void> {
  await (visible ? SystemBars.show() : SystemBars.hide());
}

export async function setBarsStyle(style: "light" | "dark" | "app"): Promise<void> {
  // Capacitor names the background: Dark = light icons, Light = dark icons.
  const s = style === "dark" ? SystemBarsStyle.Dark : style === "light" ? SystemBarsStyle.Light : SystemBarsStyle.Default;
  await SystemBars.setStyle({ style: s });
}

export async function setKeepAwake(on: boolean): Promise<void> {
  await Wortschritt.setKeepAwake({ on });
}

export async function capturePageKeys(listener: (key: PageKey) => void): Promise<() => void> {
  const handle = await Wortschritt.addListener("pageKey", ({ key }) => listener(key));
  await Wortschritt.setPageKeys({ on: true });
  return () => {
    void handle.remove();
    void Wortschritt.setPageKeys({ on: false });
  };
}

const SETTINGS_KEY = "device-settings";

export async function saveDeviceSettings(json: string): Promise<void> {
  await Preferences.set({ key: SETTINGS_KEY, value: json });
}

/** Start-up: device settings, and the back button (close a sheet, go back, or leave from Home). */
export async function startDevice(): Promise<void> {
  hydrateDeviceSettings((await Preferences.get({ key: SETTINGS_KEY })).value);
  void App.addListener("backButton", ({ canGoBack }) => {
    if (closeTopSheet()) return;
    if (canGoBack && window.location.pathname !== "/") window.history.back();
    else void App.exitApp();
  });
}
