import { timeAgo } from "@mdb/client";
import { useSync } from "@/lib/sync";
import { useTheme } from "@/lib/theme";
import { Text } from "./Text";

/** Where the data on screen stands: synced when, offline, or changes waiting to be sent. */
export function SyncLine() {
  const { status } = useSync();
  const { colors } = useTheme();
  const waiting = status.pending > 0 ? ` · ${status.pending} ${status.pending === 1 ? "change" : "changes"} to send` : "";
  const text =
    status.state === "syncing"
      ? "Syncing…"
      : status.state === "offline"
        ? `Offline${status.lastSyncAt ? ` · synced ${timeAgo(Math.floor(status.lastSyncAt / 1000))}` : ""}${waiting}`
        : status.state === "error"
          ? `Couldn't sync${waiting}`
          : status.lastSyncAt
            ? `Synced ${timeAgo(Math.floor(status.lastSyncAt / 1000))}${waiting}`
            : waiting.slice(3) || "Not synced yet";
  return (
    <Text
      variant="subtle"
      numberOfLines={1}
      style={{ color: status.state === "error" ? colors.danger : undefined }}
      accessibilityLiveRegion="polite"
    >
      {text}
    </Text>
  );
}
