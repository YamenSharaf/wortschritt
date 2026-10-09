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
 * Secrets (the sign-in tokens): the Android Keystore through expo-secure-store.
 * The web preview has no secure store, so it falls back to AsyncStorage there.
 */
export const secretStore: KeyValueStore =
  Platform.OS === "web"
    ? deviceStore
    : {
        get: (key) => SecureStore.getItemAsync(key),
        set: (key, value) => (value === null ? SecureStore.deleteItemAsync(key) : SecureStore.setItemAsync(key, value)),
      };
