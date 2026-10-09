import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "eu.yamen.wortschritt",
  appName: "Wortschritt",
  // The SPA's native build (VITE_TARGET=native), shipped inside the APK.
  webDir: "../web/dist-native",
  android: {
    // The app only talks to its server over https (see network_security_config.xml).
    allowMixedContent: false,
  },
};

export default config;
