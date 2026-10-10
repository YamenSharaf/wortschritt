import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { KeyValueStore } from "@mdb/client";

/** Per-device preferences and the server address (not secret). */
export const deviceStore: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => (value === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, value)),
};

/**
 * expo-secure-store allows only letters, digits, ".", "-" and "_" in a key;
 * ours hold a server address. Anything else (and "_" itself, so two keys
 * never collide) becomes "_" and its hex code: "a:b_c" → "a_3ab_5fc".
 */
export function secureKey(key: string): string {
  return key.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`);
}

/**
 * Secrets (the sign-in tokens): the Android Keystore through expo-secure-store.
 * The web preview has no secure store, so it falls back to AsyncStorage there.
 */
export const secretStore: KeyValueStore =
  Platform.OS === "web"
    ? deviceStore
    : {
        get: (key) => SecureStore.getItemAsync(secureKey(key)),
        set: (key, value) =>
          value === null ? SecureStore.deleteItemAsync(secureKey(key)) : SecureStore.setItemAsync(secureKey(key), value),
      };
