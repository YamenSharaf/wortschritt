import { Linking } from "react-native";
import type { Api } from "@mdb/client";
import type { NoteAttachment } from "@mdb/shared";

// The web preview: straight from the server (see attachmentFiles.native.ts for the app).
export async function attachmentText(api: Api, headers: Record<string, string>, a: NoteAttachment): Promise<string> {
  const res = await fetch(api.attachmentUrl(a.id), { headers });
  if (!res.ok) throw new Error(`The file didn't load (${res.status}).`);
  return res.text();
}

export async function openAttachment(api: Api, _headers: Record<string, string>, a: NoteAttachment): Promise<void> {
  await Linking.openURL(api.attachmentUrl(a.id));
}
