import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { font, useTheme } from "@/lib/theme";
import { Icon, sections } from "./icons";
import { Text } from "./Text";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/**
 * The phone dock: a floating pill with every section (design system: Dock).
 * Glass on a standard screen; on e-ink a plain outlined bar.
 */
export function Dock({ state, navigation }: TabBarProps) {
  const { colors, radii, elevation, effects } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 12, alignItems: "center" }}
    >
      <View
        style={{
          flexDirection: "row",
          gap: 2,
          padding: 6,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          backgroundColor: effects.blurDock > 0 ? colors.surfaceRaised : colors.dockFrom,
          boxShadow: elevation.pop === "none" ? undefined : `0 10px 30px ${colors.dockShadow}`,
          maxWidth: 560,
          marginHorizontal: 12,
        }}
      >
        {state.routes.map((route, i) => {
          const s = sections[route.name as keyof typeof sections];
          if (!s) return null;
          const active = state.index === i;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={s.label}
              onPress={() => {
                const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!active && !e.defaultPrevented) navigation.navigate(route.name);
              }}
              style={{
                minWidth: 52,
                minHeight: 48,
                paddingHorizontal: 6,
                borderRadius: radii.control + 8,
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
              }}
            >
              {/* The current section: the brand colour and bold (no bubble). */}
              <Icon icon={s.icon} size={20} color={active ? colors.brandInk : colors.inkMuted} />
              <Text style={{ fontFamily: active ? font.bold : font.medium, fontSize: 10.5, color: active ? colors.brandInk : colors.inkSubtle }}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
