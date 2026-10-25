import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json, plus what a build stamps on it: CI sets APP_VERSION_CODE (the run
 * number, so each APK installs over the last, and each iOS build is newer
 * than the one before for TestFlight) and APP_VERSION (a release tag).
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  version: process.env.APP_VERSION ?? config.version,
  android: {
    ...config.android,
    versionCode: Number(process.env.APP_VERSION_CODE ?? 1),
  },
  ios: {
    ...config.ios,
    buildNumber: process.env.APP_VERSION_CODE ?? "1",
  },
});
