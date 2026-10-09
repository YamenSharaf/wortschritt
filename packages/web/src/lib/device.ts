/**
 * Phone features the reader and shell use: system bars, keep-awake, hardware
 * page keys, the back button, and device-only settings. Everything here is a
 * no-op on the web; the native build loads ./native/device (Capacitor) lazily,
 * so the web bundle never carries it.
 */

// Inlined at build time (not IS_NATIVE from ./platform) so the web build drops
// the dynamic import below entirely.
const NATIVE = import.meta.env.VITE_TARGET === "native";

const native = NATIVE ? () => import("./native/device") : null;

/** Run a native call; a failure (an old WebView, a plugin missing) never breaks the page. */
function call(fn: (m: typeof import("./native/device")) => Promise<unknown>): void {
  void native?.()
    .then(fn)
    .catch(() => {});
}

/** Show or hide the status and navigation bars (the reader's full screen). */
export function setSystemBarsVisible(visible: boolean): void {
  call((m) => m.setBarsVisible(visible));
}

/** Status/navigation bar icons for a light or dark background; "app" follows the app's theme. */
export function setSystemBarsStyle(style: "light" | "dark" | "app"): void {
  call((m) => m.setBarsStyle(style));
}

/** The bars' style outside the reader: e-ink mode's light or dark, else the app's theme. */
export function appBarsStyle(): "light" | "dark" | "app" {
  return settings.eink === "off" ? "app" : settings.eink;
}

/** Keep the screen on (while reading). */
export function setKeepAwake(on: boolean): void {
  call((m) => m.setKeepAwake(on));
}

export type PageKey = "VolumeUp" | "VolumeDown";

/**
 * Take the volume keys to turn pages while `listener` is set (Android keeps
 * them for the volume otherwise). Returns a function that gives them back.
 */
export function capturePageKeys(listener: (key: PageKey) => void): () => void {
  if (!native) return () => {};
  let release: (() => void) | null = null;
  let done = false;
  call(async (m) => {
    const r = await m.capturePageKeys(listener);
    if (done) r();
    else release = r;
  });
  return () => {
    done = true;
    release?.();
  };
}

// --- back button ----------------------------------------------------------------

/** Open sheets and popups, newest last: the back button closes the newest. */
const backStack: (() => void)[] = [];

/** While registered, the back button calls `close` instead of going back. */
export function pushBackHandler(close: () => void): () => void {
  backStack.push(close);
  return () => {
    const i = backStack.lastIndexOf(close);
    if (i >= 0) backStack.splice(i, 1);
  };
}

/** For the native back button: close the newest sheet, if any (true when one was). */
export function closeTopSheet(): boolean {
  const close = backStack.pop();
  close?.();
  return Boolean(close);
}

// --- device-only settings ---------------------------------------------------------

/** Settings that belong to this device, not the account (kept off the server). */
export type DeviceSettings = {
  /** Turn reader pages with the volume keys (phone) or page buttons mapped to them (Boox). */
  pageKeys: boolean;
  /** Volume up = next page. */
  invertPageKeys: boolean;
  /** E-ink display: a flat, still, black-and-white app, light or dark. */
  eink: "off" | "light" | "dark";
  /** E-ink: flash the screen every this many page turns to clear ghosting (0 = never). */
  einkRefresh: number;
};
const DEFAULTS: DeviceSettings = { pageKeys: false, invertPageKeys: false, eink: "off", einkRefresh: 0 };
const KEY = "device-settings";

let settings: DeviceSettings = DEFAULTS;
const listeners = new Set<(s: DeviceSettings) => void>();

/** Native start-up hands in what Preferences holds (localStorage can be cleared by the OS). */
export function hydrateDeviceSettings(json: string | null): void {
  settings = parse(json);
  applyEink();
}

/** E-ink mode is CSS on <html data-eink="light|dark"> (index.css). */
function applyEink(): void {
  const root = document.documentElement;
  if (settings.eink === "off") delete root.dataset.eink;
  else root.dataset.eink = settings.eink;
}

function parse(json: string | null): DeviceSettings {
  try {
    return { ...DEFAULTS, ...(json ? (JSON.parse(json) as Partial<DeviceSettings>) : {}) };
  } catch {
    return DEFAULTS;
  }
}

if (!NATIVE) {
  try {
    settings = parse(localStorage.getItem(KEY));
  } catch {
    /* storage blocked: defaults */
  }
  applyEink();
}

export function getDeviceSettings(): DeviceSettings {
  return settings;
}

export function setDeviceSettings(patch: Partial<DeviceSettings>): void {
  settings = { ...settings, ...patch };
  applyEink();
  const json = JSON.stringify(settings);
  if (native) call((m) => m.saveDeviceSettings(json));
  else {
    try {
      localStorage.setItem(KEY, json);
    } catch {
      /* not kept */
    }
  }
  listeners.forEach((l) => l(settings));
}

export function onDeviceSettings(listener: (s: DeviceSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
