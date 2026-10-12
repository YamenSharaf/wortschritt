import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from "react-native-svg";
import { useTheme } from "@/lib/theme";

/** The Wortschritt mark (steps with three dots), as site/favicon.svg. */
export function Logo({ size = 28 }: { size?: number }) {
  const { scheme } = useTheme();
  const [a, b] = scheme === "dark" ? ["#4C8FD6", "#9CCBFF"] : ["#2B6CB0", "#5AA9F5"];
  return (
    <Svg width={size} height={size} viewBox="106 112 300 300">
      <Defs>
        <LinearGradient id="logoSteps" gradientUnits="userSpaceOnUse" x1="124" y1="404" x2="388" y2="184">
          <Stop offset="0" stopColor={a} />
          <Stop offset="1" stopColor={b} />
        </LinearGradient>
        <LinearGradient id="logoDots" gradientUnits="userSpaceOnUse" x1="140" y1="320" x2="372" y2="120">
          <Stop offset="0" stopColor="#FFD95A" />
          <Stop offset="0.5" stopColor="#FF8A65" />
          <Stop offset="1" stopColor="#F0508C" />
        </LinearGradient>
      </Defs>
      <Path fill="url(#logoSteps)" d="M124 404 L124 324 L212 324 L212 254 L300 254 L300 184 L388 184 L388 404 Z" />
      <G fill="url(#logoDots)">
        <Circle cx="168" cy="288" r="27" />
        <Circle cx="256" cy="218" r="27" />
        <Circle cx="344" cy="148" r="27" />
      </G>
    </Svg>
  );
}
