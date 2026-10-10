import { AppState } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { createApi, createSync, type ServerAuth } from "@mdb/client";
import { createOfflineStore } from "./offlineStore";
import { AUTH_KEY, SERVER_KEY, appFetch, makeSession } from "./server";
import { deviceStore } from "./storage";

/**
 * Sync while the app is closed (Android's WorkManager runs it now and then,
 * about hourly at best): queued answers and notes go up, new stories and
 * sets come down, so the app opens with them. With the app open, the
 * foreground sync does this, so the task does nothing then.
 */
const TASK = "wortschritt-sync";

// Defined when the bundle loads, so it exists when Android starts the app just for the task.
TaskManager.defineTask(TASK, async () => {
  try {
    if (AppState.currentState === "active") return BackgroundTask.BackgroundTaskResult.Success;
    const server = await deviceStore.get(SERVER_KEY);
    const cached = await deviceStore.get(AUTH_KEY);
    if (!server || !cached) return BackgroundTask.BackgroundTaskResult.Success;
    const session = makeSession(server, JSON.parse(cached) as ServerAuth, () => {});
    if (!(await session.load())) return BackgroundTask.BackgroundTaskResult.Success;
    const api = createApi({ baseUrl: server, fetch: appFetch, headers: session.headers, onUnauthorized: session.refreshNow });
    const sync = createSync({ api, store: createOfflineStore() });
    // Only an install that has synced before (and so belongs to this sign-in).
    if (!(await sync.hasData())) return BackgroundTask.BackgroundTaskResult.Success;
    const status = await sync.sync();
    sync.stop();
    return status.state === "error" ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 60 });
}

