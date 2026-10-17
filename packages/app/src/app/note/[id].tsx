import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { NOTE_FONT_SIZE, preferences } from "@mdb/client";
import { useNoteEditor, usePreference, useVocabState, type NoteSaveState } from "@mdb/client/react";
import { font, useTheme } from "@/lib/theme";
import { Segmented } from "@/reader/ReaderSheets";
import { WordSheet } from "@/reader/WordSheet";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Icon, sections } from "@/ui/icons";
import { Markdown } from "@/ui/Markdown";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { ChevronLeft, Sparkles, Undo2 } from "lucide-react-native";

const { min: MIN_FONT, max: MAX_FONT } = NOTE_FONT_SIZE;

/** Blocks of a long note shown at first, and added each time you scroll near the end. */
const PREVIEW_STEP = 15;

/** Writing one note: saves itself, Markdown preview with tappable words, AI clean-up, save as a cheat sheet. */
export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const note = useNoteEditor(id);
  const { title, category, body, mode, saveState, categories, aiBusy, savingSheet, undoBody } = note;
  const { colors, radii } = useTheme();
  const [fontSize, setFontSize] = usePreference(preferences.noteFontSize);
  const vocab = useVocabState();
  const [word, setWord] = useState<{ word: string; context: string } | null>(null);
  const [categoryFocus, setCategoryFocus] = useState(false);
  // The preview shows a long note a part at a time, more as you scroll (see Markdown's `limit`).
  const [shownBlocks, setShownBlocks] = useState(PREVIEW_STEP);

  const back = (
    <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 }}>
      <Icon icon={ChevronLeft} size={18} color={colors.inkMuted} />
      <Text style={{ fontFamily: font.medium, color: colors.inkMuted }}>Notes</Text>
    </Pressable>
  );

  if (note.status === "loading")
    return (
      <Screen dock={false}>
        <Text variant="muted">Loading…</Text>
      </Screen>
    );
  if (note.status === "error" || note.status === "missing")
    return (
      <Screen dock={false}>
        {back}
        <Text style={{ color: colors.danger }}>Note not found.</Text>
      </Screen>
    );

  const suggestions = categoryFocus ? categories.filter((c) => c !== category.trim() && c.toLowerCase().includes(category.trim().toLowerCase())).slice(0, 6) : [];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen dock={false} onNearEnd={mode === "preview" ? () => setShownBlocks((n) => n + PREVIEW_STEP) : undefined}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          {back}
          <SaveIndicator state={saveState} />
        </View>
        <TextInput
          value={title}
          onChangeText={note.setTitle}
          placeholder="Title"
          placeholderTextColor={colors.inkSubtle}
          accessibilityLabel="Title"
          style={{ fontFamily: font.bold, fontSize: 24, lineHeight: 30, color: colors.ink, padding: 0 }}
        />
        <View style={{ gap: 8 }}>
          <TextInput
            value={category}
            onChangeText={note.setCategory}
            onFocus={() => setCategoryFocus(true)}
            onBlur={() => setTimeout(() => setCategoryFocus(false), 150)}
            placeholder="Category (optional)"
            placeholderTextColor={colors.inkSubtle}
            accessibilityLabel="Category"
            style={{ alignSelf: "flex-start", minWidth: 180, minHeight: 36, paddingHorizontal: 12, borderRadius: radii.control, borderWidth: 1, borderColor: colors.borderControl, color: colors.ink, fontFamily: font.regular, fontSize: 14 }}
          />
          {suggestions.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {suggestions.map((c) => (
                <Chip key={c} label={c} onPress={() => note.setCategory(c)} />
              ))}
            </View>
          )}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Segmented value={mode} options={[["write", "Write"], ["preview", "Preview"]]} onChange={note.setMode} />
          <Segmented
            value=""
            options={[["smaller", "A−"], ["larger", "A+"]]}
            onChange={(v) => setFontSize((s) => Math.min(MAX_FONT, Math.max(MIN_FONT, s + (v === "larger" ? 1 : -1))))}
          />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {undoBody !== null && <Button label="Undo cleanup" icon={<Icon icon={Undo2} size={16} />} onPress={note.undoCleanUp} />}
          <Button label={aiBusy ? "Cleaning…" : "Clean up"} icon={aiBusy ? undefined : <Icon icon={Sparkles} size={16} />} busy={aiBusy} disabled={!body.trim()} onPress={() => void note.cleanUp()} />
          <Button
            label={savingSheet ? "Saving…" : "Save as cheat sheet"}
            icon={savingSheet ? undefined : <Icon icon={sections.sheets.icon} size={16} />}
            busy={savingSheet}
            disabled={!body.trim()}
            onPress={async () => {
              const sheetId = await note.saveAsCheatsheet();
              if (sheetId) router.push(`/sheet/${sheetId}`);
            }}
          />
        </View>
        {note.error ? (
          <View style={{ padding: 8, borderRadius: radii.control, backgroundColor: colors.dangerSoft }}>
            <Text style={{ fontSize: 13, color: colors.danger }}>{note.error}</Text>
          </View>
        ) : null}

        {mode === "write" ? (
          <TextInput
            value={body}
            onChangeText={note.setBody}
            multiline
            textAlignVertical="top"
            placeholder={"Write your notes here. Markdown works:\n\n# Heading\n- point one\n- **bold** and `code`"}
            placeholderTextColor={colors.inkSubtle}
            accessibilityLabel="Note"
            style={{
              minHeight: 320,
              padding: 16,
              borderRadius: radii.card,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              color: colors.ink,
              fontFamily: font.regular,
              fontSize,
              lineHeight: Math.round(fontSize * 1.6),
            }}
          />
        ) : (
          <View style={{ minHeight: 320, padding: 16, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border }}>
            {body.trim() ? (
              <Markdown text={body} size={fontSize} limit={shownBlocks} onWord={(w, context) => setWord({ word: w, context })} />
            ) : (
              <Text variant="subtle" style={{ fontStyle: "italic" }}>
                Nothing to preview yet.
              </Text>
            )}
          </View>
        )}

        <View style={{ flexDirection: "row" }}>
          <Button
            label="Delete note"
            onPress={() =>
              Alert.alert("Delete this note?", "This can't be undone.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    await note.remove();
                    router.back();
                  },
                },
              ])
            }
          />
        </View>
        {word && <WordSheet word={word.word} context={word.context} vocab={vocab} onClose={() => setWord(null)} />}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function SaveIndicator({ state }: { state: NoteSaveState }) {
  const { colors } = useTheme();
  const map: Record<NoteSaveState, [string, string]> = {
    idle: ["", colors.inkSubtle],
    saving: ["Saving…", colors.inkSubtle],
    saved: ["Saved", colors.success],
    error: ["Save failed", colors.danger],
  };
  const [text, color] = map[state];
  return text ? <Text style={{ fontSize: 13, color }}>{text}</Text> : null;
}
