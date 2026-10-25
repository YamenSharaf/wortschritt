import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { RAIL_WIDTH, useLayout } from "@/lib/layout";
import { font, useTheme } from "@/lib/theme";
import { Icon, sections } from "./icons";
import { MiniPlayer } from "./MiniPlayer";
import { Text } from "./Text";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/**
 * The phone dock: a floating pill with every section (design system: Dock),
 * and over it, while a story plays, the mini-player.
 * Glass on a standard screen; on e-ink a plain outlined bar.
 * On a tablet in landscape it stands on its side at the left edge (a rail),
 * with the mini-player at the bottom right.
 */
export function Dock(props: TabBarProps) {
  const { wide } = useLayout();
  return wide ? <Rail {...props} /> : <BottomDock {...props} />;
}

function BottomDock({ state, navigation }: TabBarProps) {
  const { colors, elevation, effects } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 12, alignItems: "center" }}
    >
      <MiniPlayer />
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
        <Items state={state} navigation={navigation} />
      </View>
    </View>
  );
}

function Rail({ state, navigation }: TabBarProps) {
  const { colors, elevation, effects } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <>
      <View
        style={{
          position: "absolute",
          left: insets.left,
          top: 0,
          bottom: 0,
          width: RAIL_WIDTH,
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            gap: 4,
            padding: 6,
            borderRadius: 28,
            borderWidth: 1,
            borderColor: colors.dockBorder,
            backgroundColor: effects.blurDock > 0 ? colors.surfaceRaised : colors.dockFrom,
            boxShadow: elevation.pop === "none" ? undefined : `0 10px 30px ${colors.dockShadow}`,
          }}
        >
          <Items state={state} navigation={navigation} vertical />
        </View>
      </View>
      <View pointerEvents="box-none" style={{ position: "absolute", right: insets.right + 28, bottom: insets.bottom + 16, width: 400 }}>
        <MiniPlayer />
      </View>
    </>
  );
}

function Items({ state, navigation, vertical = false }: Pick<TabBarProps, "state" | "navigation"> & { vertical?: boolean }) {
  const { colors, radii } = useTheme();
  return (
    <>
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
              minWidth: vertical ? 64 : 52,
              minHeight: vertical ? 56 : 48,
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
    </>
  );
}
