import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { SaveVocabBody, VocabEntry, VocabGroup } from "@mdb/shared";
import { formChips, timeAgo } from "@mdb/client";
import { filterVocab, useAddWord, useVocabState, type VocabState } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Icon, sections } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { Text } from "@/ui/Text";
import { Check, ChevronDown, ChevronUp, Plus, RotateCw, Sparkles } from "lucide-react-native";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Saved words: search, groups, flashcards, and each word's details (as on the web). */
export default function Vocab() {
  const vocab = useVocabState();
  const { entries, groups } = vocab;
  const { colors } = useTheme();
  const { status, syncNow } = useSync();
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // Pick up changes made elsewhere (the reader, flashcards, a sync).
  useEffect(() => vocab.reload(), [status.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => vocab.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps

  const poolCount = useMemo(() => filterVocab(entries, { group }).length, [entries, group]);
  const shown = useMemo(() => filterVocab(entries, { group, query: q }), [entries, q, group]);

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
        <Text variant="title">Vocab</Text>
        <Button
          kind={adding ? "secondary" : "primary"}
          label={adding ? "Close" : "Add word"}
          icon={adding ? undefined : <Icon icon={Plus} size={16} color={colors.brandInk} />}
          onPress={() => setAdding((a) => !a)}
        />
      </View>
      <Text variant="muted">Words you saved by tapping them in content, or added by hand.</Text>

      {adding && (
        <AddWord
          vocab={vocab}
          onAdd={async (body) => {
            await vocab.save(body);
            setAdding(false);
          }}
        />
      )}

      {entries.length > 0 && <SearchField value={q} onChange={setQ} placeholder="Search words…" />}
      <GroupBar
        groups={groups}
        selected={group}
        onSelect={setGroup}
        onCreate={vocab.createGroup}
        onDelete={(g) =>
          Alert.alert(`Delete the group “${g.name}”?`, "The words stay in your vocab.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => {
                if (group === g.id) setGroup(null);
                vocab.deleteGroup(g.id).catch((e) => Alert.alert("Couldn't delete the group", msg(e)));
              },
            },
          ])
        }
      />

      {poolCount > 0 && (
        <Button
          kind="primary"
          label={`Study flashcards · ${group == null ? `all ${poolCount}` : poolCount} card${poolCount === 1 ? "" : "s"}`}
          icon={<Icon icon={sections.vocab.icon} size={16} color={colors.brandInk} />}
          onPress={() => router.push(`/vocab/study?group=${group ?? "all"}`)}
        />
      )}

      {shown.length === 0 ? (
        <View style={{ padding: 24, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderControl }}>
          <Text variant="muted" style={{ textAlign: "center" }}>
            {entries.length === 0 ? "No words yet. Tap a word in a story or cheat sheet and save it, or use Add word above." : "No words match."}
          </Text>
        </View>
      ) : (
        <Card>
          {shown.map((e, i) => (
            <VocabRow key={e.word} entry={e} first={i === 0} vocab={vocab} open={open === e.word} onToggle={() => setOpen(open === e.word ? null : e.word)} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function AddWord({ vocab, onAdd }: { vocab: VocabState; onAdd: (body: SaveVocabBody) => Promise<void> }) {
  const form = useAddWord({ enabled: vocab.enabled, dictAvailable: vocab.dictAvailable });
  const { word, definition, busy, genBusy, error, canGenerate } = form;
  const { colors } = useTheme();
  return (
    <Card style={{ padding: 16, gap: 10 }}>
      <Field value={word} onChange={form.setWord} placeholder="Word (German)" autoFocus />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field value={definition} onChange={form.setDefinition} placeholder="Translation (optional)" />
        </View>
        {canGenerate && (
          <Button
            label={genBusy ? "…" : "Generate"}
            icon={genBusy ? undefined : <Icon icon={Sparkles} size={16} />}
            disabled={!word.trim() || genBusy || busy}
            onPress={() => void form.generate()}
            accessibilityLabel={vocab.enabled ? "Generate the translation with AI" : "Fill from the built-in dictionary"}
          />
        )}
      </View>
      <Button kind="primary" label={busy ? "Adding…" : "Add"} busy={busy} disabled={genBusy || !word.trim()} onPress={() => void form.add(onAdd)} />
      {error ? <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text> : null}
      <Text variant="subtle">
        {vocab.enabled
          ? "Leave the translation blank and Add fills it (with examples) using AI — or tap Generate first."
          : vocab.dictAvailable
            ? "Leave the translation blank to fill it from the built-in dictionary."
            : "Enter a translation (AI tutor not configured)."}
      </Text>
    </Card>
  );
}

function Field({ value, onChange, placeholder, autoFocus, small }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; small?: boolean }) {
  const { colors, radii } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.inkSubtle}
      accessibilityLabel={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={autoFocus}
      style={{
        minHeight: small ? 34 : 44,
        minWidth: small ? 120 : undefined,
        paddingHorizontal: small ? 12 : 14,
        borderRadius: small ? 999 : radii.control,
        borderWidth: 1,
        borderStyle: small ? "dashed" : "solid",
        borderColor: colors.borderControl,
        backgroundColor: small ? "transparent" : colors.surface,
        color: colors.ink,
        fontFamily: font.regular,
        fontSize: small ? 13 : 16,
      }}
    />
  );
}

/** "All", the groups (tap to filter, long-press or × to delete), and a new one. */
function GroupBar({
  groups,
  selected,
  onSelect,
  onCreate,
  onDelete,
}: {
  groups: VocabGroup[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  onCreate: (name: string) => Promise<VocabGroup>;
  onDelete: (g: VocabGroup) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const { colors } = useTheme();
  const create = async () => {
    const n = name.trim();
    setName("");
    setCreating(false);
    if (n) await onCreate(n).catch((e) => Alert.alert("Couldn't create the group", msg(e)));
  };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <Chip label="All" on={selected === null} onPress={() => onSelect(null)} />
      {groups.map((g) => (
        <Chip
          key={g.id}
          label={`${g.name} ${g.count}`}
          a11y={`${g.name}, ${g.count} words${selected === g.id ? ". Long-press to delete" : ""}`}
          on={selected === g.id}
          onPress={() => onSelect(selected === g.id ? null : g.id)}
          onLongPress={() => onDelete(g)}
        />
      ))}
      {creating ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Field value={name} onChange={setName} placeholder="Group name" autoFocus small />
          <Pressable onPress={() => void create()} accessibilityRole="button" hitSlop={8}>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.brandInk }}>{name.trim() ? "Add" : "Cancel"}</Text>
          </Pressable>
        </View>
      ) : (
        <Chip label="New group" dashed icon={<Icon icon={Plus} size={14} color={colors.inkMuted} />} onPress={() => setCreating(true)} />
      )}
    </View>
  );
}

function VocabRow({ entry, first, vocab, open, onToggle }: { entry: VocabEntry; first: boolean; vocab: VocabState; open: boolean; onToggle: () => void }) {
  const { colors, radii } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const s = entry.stats;

  const run = (f: () => Promise<unknown>) => {
    setError(null);
    f().catch((e) => setError(msg(e)));
  };

  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: colors.border }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? colors.surfaceSunken : "transparent" })}
      >
        <Text numberOfLines={1} style={{ width: "34%", fontFamily: font.medium }}>
          {entry.display}
        </Text>
        <Text variant="muted" numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>
          {entry.translation}
        </Text>
        {s?.lastResult != null && (
          <View
            accessibilityLabel={`Flashcards: ${s.known} known, ${s.missed} missed`}
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.lastResult ? colors.success : colors.warning }}
          />
        )}
        <Icon icon={open ? ChevronUp : ChevronDown} size={14} color={colors.inkSubtle} />
      </Pressable>

      {open && (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 16, gap: 12 }}>
          <Text>{entry.translation}</Text>
          {formChips(entry.forms).length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {formChips(entry.forms).map(([label, val]) => (
                <View key={label} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.surfaceSunken }}>
                  <Text style={{ fontSize: 12 }}>
                    <Text style={{ fontSize: 12, color: colors.inkSubtle }}>{label}: </Text>
                    <Text style={{ fontSize: 12, fontFamily: font.medium }}>{val}</Text>
                  </Text>
                </View>
              ))}
            </View>
          )}
          <View style={{ gap: 8 }}>
            {entry.examples.map((ex, i) => (
              <View key={i} style={{ padding: 10, borderRadius: radii.control, backgroundColor: colors.surfaceSunken }}>
                <Text style={{ fontSize: 14, lineHeight: 20 }}>{ex.de}</Text>
                <Text variant="muted" style={{ fontSize: 14, lineHeight: 20 }}>
                  {ex.en}
                </Text>
              </View>
            ))}
            {entry.examples.length === 0 && <Text variant="subtle">No examples yet.</Text>}
          </View>

          <View style={{ gap: 6 }}>
            <Text variant="subtle" style={{ fontFamily: font.medium }}>
              Groups
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              {vocab.groups.map((g) => {
                const member = entry.groups.includes(g.id);
                return (
                  <Chip
                    key={g.id}
                    label={g.name}
                    on={member}
                    icon={member ? <Icon icon={Check} size={12} color={colors.brandInk} /> : undefined}
                    onPress={() => run(() => vocab.setWordGroup(entry.word, g.id, !member))}
                  />
                );
              })}
              <Field value={newGroup} onChange={setNewGroup} placeholder="New group" small />
              {newGroup.trim() ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() =>
                    run(async () => {
                      const g = await vocab.createGroup(newGroup.trim());
                      await vocab.setWordGroup(entry.word, g.id, true);
                      setNewGroup("");
                    })
                  }
                >
                  <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.brandInk }}>Add</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {s && (
            <Text variant="subtle">
              Flashcards: <Text style={{ fontSize: 13, color: colors.success }}>{s.known} known</Text> ·{" "}
              <Text style={{ fontSize: 13, color: colors.danger }}>{s.missed} missed</Text>
              {s.lastStudiedAt ? ` · last ${timeAgo(s.lastStudiedAt)}` : ""} ·{" "}
              <Text onPress={() => run(() => vocab.resetStudy(entry.word))} style={{ fontSize: 13, color: colors.inkSubtle, textDecorationLine: "underline" }}>
                reset
              </Text>
            </Text>
          )}

          {error ? (
            <View style={{ padding: 8, borderRadius: radii.control, backgroundColor: colors.dangerSoft }}>
              <Text style={{ fontSize: 13, color: colors.danger }}>{error}</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              label={busy ? "Regenerating…" : "Regenerate"}
              icon={busy ? undefined : <Icon icon={RotateCw} size={16} />}
              busy={busy}
              disabled={!vocab.enabled}
              onPress={() => {
                setBusy(true);
                run(() => vocab.refresh(entry).finally(() => setBusy(false)));
              }}
            />
            <Button
              label="Remove"
              onPress={() =>
                Alert.alert(`Remove “${entry.display}”?`, undefined, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => run(() => vocab.remove(entry.word)) },
                ])
              }
            />
          </View>
        </View>
      )}
    </View>
  );
}
