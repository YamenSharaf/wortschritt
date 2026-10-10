import { TextInput } from "react-native";
import { font, useTheme } from "@/lib/theme";

/** A list's search box. */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { colors, radii } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.inkSubtle}
      accessibilityLabel={placeholder.replace(/…$/, "")}
      autoCorrect={false}
      style={{
        minHeight: 44,
        paddingHorizontal: 14,
        borderRadius: radii.control,
        borderWidth: 1,
        borderColor: colors.borderControl,
        backgroundColor: colors.surface,
        color: colors.ink,
        fontFamily: font.regular,
      }}
    />
  );
}

/** Newest first (by `createdAt`), or A–Z by title as German sorts it. */
export function sortByMode<T extends { title: string; createdAt?: string }>(items: T[], mode: "recent" | "az"): T[] {
  if (mode === "az") return [...items].sort((a, b) => a.title.localeCompare(b.title, "de"));
  const ts = (v?: string) => (v ? Date.parse(v) || 0 : 0);
  return [...items].sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
}
