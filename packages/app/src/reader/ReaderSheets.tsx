import { useEffect, useRef, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Switch, View, useWindowDimensions } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReaderSettings, Story } from "@mdb/shared";
import { font, useTheme } from "@/lib/theme";
import { Text } from "@/ui/Text";
import { READER_FONTS, readerColors } from "./style";

/**
 * A sheet from the bottom over the reader: the shade fades in where it is and
 * only the panel slides up (and the same back on closing). Nothing moves on
 * e-ink or with reduced motion.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { colors, radii, motion } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const animated = motion.base > 0;
  const shown = useSharedValue(animated ? 0 : 1);
  const closing = useRef(false);
  useEffect(() => {
    if (animated) shown.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (!animated) return onClose();
    shown.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) scheduleOnRN(onClose);
    });
  };
  const shade = useAnimatedStyle(() => ({ opacity: shown.value }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - shown.value) * height * 0.75 }] }));
  return (
    <Modal transparent visible animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[{ flex: 1, backgroundColor: colors.scrim }, shade]}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            maxHeight: "75%",
            backgroundColor: colors.surfaceRaised,
            borderTopLeftRadius: radii.panel,
            borderTopRightRadius: radii.panel,
            borderWidth: 1,
            borderColor: colors.border,
            paddingBottom: insets.bottom + 8,
          },
          panel,
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
          <Text variant="eyebrow" style={{ flex: 1 }}>
            {title}
          </Text>
          <Pressable onPress={close} accessibilityRole="button" hitSlop={12}>
            <Text style={{ fontFamily: font.medium, color: colors.brandInk }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 16 }}>{children}</ScrollView>
      </Animated.View>
    </Modal>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  compact,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  /** One line, smaller (a list's sort beside its search). */
  compact?: boolean;
}) {
  const { colors, radii } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: compact ? "nowrap" : "wrap", borderWidth: 1, borderColor: colors.border, borderRadius: radii.control, padding: 2, gap: 2 }}>
      {options.map(([v, label]) => {
        const on = value === v;
        return (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              minHeight: compact ? 38 : 36,
              paddingHorizontal: compact ? 10 : 12,
              justifyContent: "center",
              borderRadius: radii.control - 2,
              backgroundColor: on ? colors.brandSoft : "transparent",
            }}
          >
            <Text style={{ fontFamily: on ? font.semibold : font.regular, fontSize: 14, color: on ? colors.brandInk : colors.ink }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text variant="muted">{label}</Text>
      {children}
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: colors.brand, false: colors.borderStrong }}
        thumbColor={colors.surface}
      />
    </View>
  );
}

/** Text settings: saved to the account (all devices), except full screen (this device). */
export function SettingsPanel({
  value,
  onChange,
  canTranslate,
  canSpeak,
  device,
}: {
  value: ReaderSettings;
  onChange: (p: Partial<ReaderSettings>) => void;
  canTranslate: boolean;
  canSpeak?: boolean;
  /** This device's own reader options (kept here, not in the account). */
  device: {
    fullscreen: boolean;
    setFullscreen: (v: boolean) => void;
    /** null where there are no volume keys to use (not Android). */
    volumeKeys: { on: boolean; set: (v: boolean) => void; invert: boolean; setInvert: (v: boolean) => void } | null;
  };
}) {
  const { colors, display, scheme, radii } = useTheme();
  const themes = (["auto", "light", "sepia", "dark"] as const).filter((t) => !(display === "eink" && t === "sepia"));
  return (
    <>
      <Row label="Layout">
        <Segmented value={value.layout} options={[["pages", "Pages"], ["scroll", "Scroll"]]} onChange={(layout) => onChange({ layout })} />
      </Row>
      <Row label="Font">
        <Segmented
          value={value.font}
          options={(Object.keys(READER_FONTS) as ReaderSettings["font"][]).map((f) => [f, READER_FONTS[f].label])}
          onChange={(f) => onChange({ font: f })}
        />
      </Row>
      <Row label="Size">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Step label="A−" a11y="Smaller text" onPress={() => onChange({ size: Math.max(14, value.size - 1) })} />
          <Text style={{ fontFamily: font.mono, width: 48, textAlign: "center" }}>{value.size}px</Text>
          <Step label="A+" a11y="Larger text" onPress={() => onChange({ size: Math.min(30, value.size + 1) })} />
        </View>
      </Row>
      <Row label="Line spacing">
        <Segmented
          value={value.lineHeight}
          options={[["compact", "Compact"], ["normal", "Normal"], ["relaxed", "Relaxed"]]}
          onChange={(lineHeight) => onChange({ lineHeight })}
        />
      </Row>
      <Row label="Theme">
        <View style={{ flexDirection: "row", gap: 12 }}>
          {themes.map((t) => {
            const c = readerColors(t, display, scheme);
            const on = value.theme === t;
            return (
              <Pressable
                key={t}
                onPress={() => onChange({ theme: t })}
                accessibilityRole="button"
                accessibilityLabel={`${t[0]!.toUpperCase()}${t.slice(1)} theme`}
                accessibilityState={{ selected: on }}
                style={{ alignItems: "center", gap: 4 }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: c.bg,
                    borderWidth: on ? 3 : 1,
                    borderColor: on ? colors.focus : colors.borderStrong,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontFamily: font.semibold, color: c.fg }}>{t === "auto" ? "A" : "Aa"}</Text>
                </View>
                <Text variant="subtle">{t === "auto" ? "Auto" : t[0]!.toUpperCase() + t.slice(1)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Row>
      {canTranslate && (
        <Row label="English line by line">
          <Segmented
            value={value.translations}
            options={[["off", "Off"], ["peek", "Peek"], ["always", "Always"]]}
            onChange={(translations) => onChange({ translations })}
          />
        </Row>
      )}
      {canSpeak && (
        <Row label="Reading aloud">
          <Segmented
            value={String(value.speechRate)}
            options={[["0.75", "Slow"], ["0.95", "Normal"], ["1.15", "Fast"]]}
            onChange={(r) => onChange({ speechRate: Number(r) })}
          />
        </Row>
      )}
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, borderRadius: radii.control }}>
        <Toggle label="Underline words I've saved" value={value.highlightVocab} onChange={(highlightVocab) => onChange({ highlightVocab })} />
      </View>
      <View style={{ gap: 4 }}>
        <Text variant="eyebrow">This device</Text>
        <Toggle label="Full screen" value={device.fullscreen} onChange={device.setFullscreen} />
        {device.volumeKeys && (
          <>
            <Toggle label="Turn pages with volume keys" value={device.volumeKeys.on} onChange={device.volumeKeys.set} />
            {device.volumeKeys.on && (
              <Toggle label="Invert (volume up = next page)" value={device.volumeKeys.invert} onChange={device.volumeKeys.setInvert} />
            )}
          </>
        )}
      </View>
    </>
  );
}

function Step({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  const { colors, radii } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={{
        minWidth: 48,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: colors.borderStrong,
        borderRadius: radii.control,
        backgroundColor: colors.surface,
      }}
    >
      <Text style={{ fontFamily: font.semibold }}>{label}</Text>
    </Pressable>
  );
}

export function GlossaryPanel({ entries }: { entries: Story["glossary"] }) {
  return (
    <View style={{ gap: 10 }}>
      {entries.map((g) => (
        <View key={g.term}>
          <Text style={{ fontFamily: font.semibold }}>{g.term}</Text>
          <Text variant="muted">{g.meaning}</Text>
        </View>
      ))}
    </View>
  );
}
