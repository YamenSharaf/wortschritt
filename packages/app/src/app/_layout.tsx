import { useEffect, useMemo, type ReactNode } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
// One file per weight, so only these are bundled.
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { Geist_700Bold } from "@expo-google-fonts/geist/700Bold";
import { GeistMono_500Medium } from "@expo-google-fonts/geist-mono/500Medium";
import { preferences, serverTtsFor } from "@mdb/client";
import { AuthProvider, ClientProvider, useApi, useSpeech } from "@mdb/client/react";
import { appSpeech } from "@/lib/speech";
// Defines the background sync task when the bundle loads (also when Android starts it for the task).
import { registerBackgroundSync } from "@/lib/backgroundSync";
import { ServerProvider, useServer } from "@/lib/server";
import { deviceStore } from "@/lib/storage";
import { SyncProvider } from "@/lib/sync";
import { ListeningProvider, useListening } from "@/lib/listening";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { useOrientationLock } from "@/lib/orientation";
import { checkForUpdate, updatesSupported } from "@/lib/updates";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, GeistMono_500Medium });
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ServerProvider>
            <Providers>
              <Root />
            </Providers>
          </ServerProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** The shared client (API once a server is known, this device's storage), the theme, and who's signed in. */
function Providers({ children }: { children: ReactNode }) {
  const { api, status, mediaHeaders } = useServer();
  const speech = useMemo(() => (api ? appSpeech(api.ttsUrl, mediaHeaders) : undefined), [api, mediaHeaders]);
  return (
    <ClientProvider api={api ?? undefined} speech={speech} storage={deviceStore}>
      <ThemeProvider>
        {status === "signed-in" ? (
          <AuthProvider>
            <ListeningProvider api={api} headers={mediaHeaders}>
              <SpeechSetup />
              <SyncProvider>{children}</SyncProvider>
            </ListeningProvider>
          </AuthProvider>
        ) : (
          children
        )}
      </ThemeProvider>
    </ClientProvider>
  );
}

/** Once signed in: background sync on, and the server's voice when the account chose one it has (else the phone's). */
function SpeechSetup() {
  const api = useApi();
  const speech = useSpeech();
  const { controller: listening } = useListening();
  useEffect(() => {
    registerBackgroundSync().catch(() => {});
  }, []);
  useEffect(() => {
    Promise.all([api.ttsStatus(), api.settings()])
      .then(([st, se]) => {
        const tts = serverTtsFor(st, se);
        speech.setServerTts(tts);
        // A server reading voice: stories are listened to as one file (background, lock screen, downloads).
        listening?.setEnabled(tts.readerEnabled);
      })
      .catch(() => {});
  }, [api, speech, listening]);
  return null;
}

/** Each time the app opens (and when it comes back after an hour away), look for a newer build unless that's turned off. */
function useUpdateCheck() {
  useEffect(() => {
    if (!updatesSupported) return;
    let last = 0;
    const check = async () => {
      if (Date.now() - last < 60 * 60 * 1000) return;
      last = Date.now();
      const raw = await Promise.resolve(deviceStore.get(preferences.autoUpdate.key)).catch(() => null);
      if ((raw === null ? undefined : preferences.autoUpdate.parse(raw)) ?? preferences.autoUpdate.fallback) await checkForUpdate({ quiet: true });
    };
    void check();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void check());
    return () => sub.remove();
  }, []);
}

/** Which screens exist depends on the state: connect to a server, sign in, then the app. */
function Root() {
  const { status } = useServer();
  useUpdateCheck();
  useOrientationLock();
  const { colors, scheme, motion } = useTheme();
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);
  useEffect(() => {
    if (status !== "loading") SplashScreen.hideAsync().catch(() => {});
  }, [status]);
  if (status === "loading") return null;
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          // E-ink and reduced motion: screens appear, they don't slide.
          animation: motion.base === 0 ? "none" : "default",
        }}
      >
        <Stack.Protected guard={status === "signed-in"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="account" options={{ presentation: "modal" }} />
          <Stack.Screen name="reading-aloud" />
          <Stack.Screen name="player" options={{ presentation: "modal" }} />
          <Stack.Screen name="reader/[id]" />
          <Stack.Screen name="series/[id]" />
          <Stack.Screen name="practice/[id]" />
          <Stack.Screen name="sheet/[id]" />
          <Stack.Screen name="vocab/study" />
          <Stack.Screen name="note/[id]" />
          <Stack.Screen name="attachment/[id]" />
          <Stack.Screen name="import" />
          <Stack.Screen name="favorites" />
          <Stack.Screen name="quiz/[id]" />
          <Stack.Screen name="licenses" />
        </Stack.Protected>
        <Stack.Protected guard={status === "no-server"}>
          <Stack.Screen name="connect" />
        </Stack.Protected>
        <Stack.Protected guard={status === "signed-out"}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Screen name="oauth/callback" />
      </Stack>
    </>
  );
}
