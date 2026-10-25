import { useWindowDimensions } from "react-native";

/** Width of the side rail that stands in for the dock on a tablet in landscape. */
export const RAIL_WIDTH = 92;

/**
 * How much room the screen gives. `wide` is a tablet in landscape: the dock
 * becomes a side rail and pages that can split (Home, reader, player,
 * exercise) put two things side by side. A phone turned sideways is not
 * wide (too short), and keeps the phone layouts, scrolling where needed.
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const wide = width >= 900 && height >= 600 && width > height;
  return { width, height, wide };
}
