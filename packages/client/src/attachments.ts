/** What a note attachment is, for its icon and how it opens. */
export type AttachmentKind = "text" | "image" | "audio" | "pdf" | "file";

export function attachmentKind(type: string): AttachmentKind {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/") || type === "application/json" || type === "application/xml") return "text";
  return "file";
}

/** "820 B", "14 KB", "3.2 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
