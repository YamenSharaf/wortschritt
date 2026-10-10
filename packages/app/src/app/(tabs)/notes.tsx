import { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { timeAgo } from "@mdb/client";
import { filterNotes, noteCategories, noteSnippet, useApi, useAsync } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { IconTile } from "@/ui/IconTile";
import { PressCard } from "@/ui/PressCard";
import { Chip } from "@/ui/Chip";
import { Icon, sections } from "@/ui/icons";
import { Pill } from "@/ui/Pill";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { Text } from "@/ui/Text";
import { Plus } from "lucide-react-native";

/** Notes (on the device once synced; written offline too), as on the web. */
export default function Notes() {
  const api = useApi();
  const { colors } = useTheme();
  const { status, syncNow } = useSync();
  const notes = useAsync(() => api.notes(), [api, status.revision], { keep: true });
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = notes.status === "ready" ? notes.data : [];
  const categories = useMemo(() => noteCategories(list), [list]);
  const shown = useMemo(() => filterNotes(list, { category, query: q }), [list, q, category]);

  async function newNote() {
    if (creating) return;
    setCreating(true);
    try {
      const n = await api.createNote({ title: "Untitled" });
      router.push(`/note/${n.id}`);
    } catch (e) {
      Alert.alert("Couldn't create a note", e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen
      onRefresh={async () => {
        setRefreshing(true);
        await syncNow();
        setRefreshing(false);
      }}
      refreshing={refreshing}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="title">Notes</Text>
        <Button
          kind="primary"
          label={creating ? "…" : "New note"}
          icon={creating ? undefined : <Icon icon={Plus} size={16} color={colors.brandInk} />}
          onPress={() => void newNote()}
        />
      </View>
      <Text variant="muted">Jot down anything as you learn. Notes support Markdown and save automatically.</Text>
      {list.length > 3 && <SearchField value={q} onChange={setQ} placeholder="Search notes…" />}
      {categories.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Chip label="All" on={category === null} onPress={() => setCategory(null)} />
          {categories.map((c) => (
            <Chip key={c} label={c} on={category === c} onPress={() => setCategory(category === c ? null : c)} />
          ))}
        </View>
      )}
      {notes.status === "error" && <Text style={{ color: colors.danger }}>Couldn't load your notes. Pull to try again.</Text>}
      {notes.status === "ready" && list.length === 0 && (
        <View style={{ padding: 24, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderControl }}>
          <Text variant="muted" style={{ textAlign: "center" }}>
            No notes yet. Tap “New note” to start writing.
          </Text>
        </View>
      )}
      {notes.status === "ready" && list.length > 0 && shown.length === 0 && <Text variant="muted">No notes match.</Text>}
      <View style={{ gap: 12 }}>
        {shown.map((n) => {
          const preview = noteSnippet(n.body);
          return (
            <PressCard key={n.id} onPress={() => router.push(`/note/${n.id}`)} style={{ padding: 16, flexDirection: "row", gap: 12 }}>
              <IconTile icon={sections.notes.icon} color={colors.sectionNotes} />
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Text style={{ flex: 1, fontFamily: font.semibold }}>{n.title.trim() || "Untitled"}</Text>
                  <Text variant="subtle">{timeAgo(n.updatedAt)}</Text>
                </View>
                <Text variant="muted" numberOfLines={3} style={{ fontSize: 14, lineHeight: 20, fontStyle: preview ? "normal" : "italic" }}>
                  {preview || "Empty note"}
                </Text>
                {n.category.trim() ? (
                  <View style={{ flexDirection: "row", marginTop: 6 }}>
                    <Pill text={n.category.trim()} />
                  </View>
                ) : null}
              </View>
            </PressCard>
          );
        })}
      </View>
    </Screen>
  );
}
