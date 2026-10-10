import { Platform } from "react-native";
import Constants from "expo-constants";
import { Directory, File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { getUpdateState, setUpdateState, type Release } from "./updateStore";

/**
 * The Android app updates itself from the repo's GitHub releases: each build
 * of main is a pre-release `app-<run>` with the APK attached, and the run
 * number is also the app's version code. A newer one is downloaded into the
 * cache and handed to Android's installer (which asks before installing; the
 * first time, it asks to allow installs from Wortschritt).
 */

const RELEASES = "https://api.github.com/repos/YamenSharaf/wortschritt/releases?per_page=10";
const dir = new Directory(Paths.cache, "updates");

export const updatesSupported = Platform.OS === "android" && !__DEV__;

/** This build's number: the version code CI stamps (or the last part of the version). */
export function currentBuild(): number {
  const code = Constants.expoConfig?.android?.versionCode;
  if (typeof code === "number" && code > 1) return code;
  const last = Number((Constants.expoConfig?.version ?? "").split(".").pop());
  return Number.isFinite(last) ? last : 0;
}

type GitHubRelease = { tag_name: string; draft: boolean; assets: { name: string; browser_download_url: string; size: number }[] };

async function latestRelease(): Promise<Release | null> {
  const res = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const list = (await res.json()) as GitHubRelease[];
  let best: Release | null = null;
  for (const r of list) {
    const m = /^app-(\d+)$/.exec(r.tag_name);
    const apk = r.assets.find((a) => a.name.endsWith(".apk"));
    if (r.draft || !m || !apk) continue;
    const build = Number(m[1]);
    if (!best || build > best.build) best = { build, tag: r.tag_name, apkUrl: apk.browser_download_url, size: apk.size };
  }
  return best;
}

function apkFile(release: Release): File {
  return new File(dir, `wortschritt-${release.build}.apk`);
}

/** Drop downloaded APKs this build has already caught up with. */
function cleanUp() {
  if (!dir.exists) return;
  const now = currentBuild();
  for (const f of dir.list()) {
    const build = Number(/(\d+)\.apk$/.exec(f.name)?.[1]);
    if (f instanceof File && (!Number.isFinite(build) || build <= now)) f.delete();
  }
}

let checking: Promise<void> | null = null;

/** Look for a newer build (a quiet check leaves no error behind). */
export function checkForUpdate({ quiet = false } = {}): Promise<void> {
  if (!updatesSupported) return Promise.resolve();
  const busy = getUpdateState().phase;
  if (busy === "downloading" || busy === "ready") return Promise.resolve();
  checking ??= (async () => {
    setUpdateState({ phase: "checking" });
    try {
      cleanUp();
      const release = await latestRelease();
      if (!release || release.build <= currentBuild()) return setUpdateState({ phase: "current" });
      const file = apkFile(release);
      setUpdateState(file.exists && file.size === release.size ? { phase: "ready", release, file: file.uri } : { phase: "available", release });
    } catch (e) {
      setUpdateState(quiet ? { phase: "idle" } : { phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  })().finally(() => (checking = null));
  return checking;
}

/** Download the newer build, then open the installer. */
export async function downloadAndInstall(): Promise<void> {
  const s = getUpdateState();
  if (s.phase === "ready") return install(s.release, s.file);
  if (s.phase !== "available" && !(s.phase === "error" && s.release)) return;
  const release = s.release!;
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = apkFile(release);
    if (file.exists) file.delete();
    setUpdateState({ phase: "downloading", release, progress: 0 });
    const task = File.createDownloadTask(release.apkUrl, file, {
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : release.size;
        setUpdateState({ phase: "downloading", release, progress: total ? Math.min(1, bytesWritten / total) : 0 });
      },
    });
    const got = await task.downloadAsync();
    if (!got?.exists || (release.size && got.size !== release.size)) throw new Error("The download was incomplete.");
    setUpdateState({ phase: "ready", release, file: got.uri });
    await install(release, got.uri);
  } catch (e) {
    setUpdateState({ phase: "error", release, message: e instanceof Error ? e.message : String(e) });
  }
}

async function install(release: Release, uri: string) {
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: new File(uri).contentUri,
      type: "application/vnd.android.package-archive",
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch (e) {
    setUpdateState({ phase: "error", release, message: e instanceof Error ? e.message : String(e) });
  }
}
