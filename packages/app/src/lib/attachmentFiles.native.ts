import { Directory, File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import type { Api } from "@mdb/client";
import type { NoteAttachment } from "@mdb/shared";

// Opened attachments stay in the cache (an id's file never changes), so a
// second look, or one offline, needs no download.
const dir = new Directory(Paths.cache, "attachments");

async function local(api: Api, headers: Record<string, string>, a: NoteAttachment): Promise<File> {
  const file = new File(dir, `${a.id}-${a.name.replace(/[^\w.-]+/g, "_")}`);
  if (file.exists && file.size === a.size) return file;
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const got = await File.downloadFileAsync(api.attachmentUrl(a.id), file, { headers, idempotent: true });
  if (!got.exists || !got.size) throw new Error("The file didn't download.");
  return got;
}

/** A text attachment's text. */
export async function attachmentText(api: Api, headers: Record<string, string>, a: NoteAttachment): Promise<string> {
  return (await local(api, headers, a)).text();
}

/** Hand the file to whichever app opens its type (a PDF viewer, a player…). */
export async function openAttachment(api: Api, headers: Record<string, string>, a: NoteAttachment): Promise<void> {
  const file = await local(api, headers, a);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: file.contentUri,
    type: a.type,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}
