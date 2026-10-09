/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "native" for the Android build (see lib/platform.ts); unset on the web. */
  readonly VITE_TARGET?: "native";
}
