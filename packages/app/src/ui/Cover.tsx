import { memo } from "react";
import { PixelRatio } from "react-native";
import { Image } from "expo-image";
import { useServer } from "@/lib/server";
import { useTheme } from "@/lib/theme";

/**
 * A story's, chapter's or book's cover: its drawn art, or one the server
 * makes from the title. The server renders it to a PNG at about the size
 * shown (Android draws these SVGs badly, and slowly while scrolling). The
 * URL carries the art's version, and the image stays in the disk cache, so
 * covers are there offline once seen.
 */
export const Cover = memo(function Cover({
  kind,
  id,
  version,
  fallbackKey,
  width,
}: {
  kind: "story" | "series";
  id: string;
  /** The cover version from the summary (null = a generated cover). */
  version: string | null;
  /** Changes when a generated cover would (e.g. the title). */
  fallbackKey: string;
  width: number;
}) {
  const { api, mediaHeaders } = useServer();
  const { colors } = useTheme();
  if (!api) return null;
  const uri = api.coverPngUrl(kind, id, version ?? `g-${fallbackKey}`, PixelRatio.getPixelSizeForLayoutSize(width));
  return (
    <Image
      source={{ uri, headers: mediaHeaders() }}
      recyclingKey={uri}
      cachePolicy="disk"
      contentFit="cover"
      transition={0}
      accessibilityIgnoresInvertColors
      style={{
        width,
        aspectRatio: 2 / 3,
        borderRadius: 6,
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: colors.border,
      }}
    />
  );
});
