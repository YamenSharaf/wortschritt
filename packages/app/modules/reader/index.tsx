import type { ViewProps } from "react-native";
import { Platform, Text, View } from "react-native";
import { requireNativeView } from "expo";

export type ComposeReaderProps = ViewProps & {
  storyTitle: string;
  paragraphs: string[];
  mode: "pages" | "scroll";
  fontSize: number;
  /** A multiple of the font size. */
  lineHeight: number;
  serif: boolean;
  /** #rrggbb */
  textColor: string;
  pageColor: string;
  onWordPress?: (e: { nativeEvent: { word: string; paragraph: number } }) => void;
  onPageChange?: (e: { nativeEvent: { page: number; count: number } }) => void;
  onCenterTap?: () => void;
};

/**
 * The Compose reader (android/…/Reader.kt): the story laid out, paged and
 * hit-tested natively. Android only; elsewhere a note says so.
 */
export const ComposeReader =
  Platform.OS === "android"
    ? requireNativeView<ComposeReaderProps>("WortschrittReader")
    : function Unavailable(props: ComposeReaderProps) {
        return (
          <View style={[props.style, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
            <Text style={{ color: props.textColor, textAlign: "center" }}>The Compose reader runs on Android only.</Text>
          </View>
        );
      };
