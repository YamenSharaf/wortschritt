import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import type { DictEntry, WordDetails } from "@mdb/shared";
import { perfektAux } from "@mdb/client";
import { useWordLookup, useWordTranslation, type VocabState } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { SpeakButton } from "@/ui/SpeakButton";
import { Sheet } from "./ReaderSheets";

const POS_LABEL: Record<string, string> = {
  verb: "verb",
  noun: "noun",
  adj: "adjective",
  adv: "adverb",
  prep: "preposition",
  conj: "conjunction",
  pron: "pronoun",
  det: "determiner",
  num: "number",
  interj: "interjection",
  intj: "interjection",
};

/**
 * A tapped word, as on the web: the offline dictionary's gloss and the
 * Wiktionary senses at once; "Translate" asks the AI (with the sentence) and
 * offers to save the word, under its base form, to vocab and its groups.
 */
export function WordSheet({ word, context, vocab, onClose }: { word: string; context?: string; vocab: VocabState; onClose: () => void }) {
  const { dict, details } = useWordLookup(word);
  const [translating, setTranslating] = useState(false);
  const offline = useSync().status.state === "offline";
  return (
    <Sheet title={translating ? "Translate" : "Word"} onClose={onClose}>
      {translating ? (
        <TranslatePanel word={word} context={context} dict={dict ?? null} vocab={vocab} onClose={onClose} />
      ) : (
        <>
          <Gloss word={word} dict={dict} hasDetails={Boolean(details)} aiEnabled={vocab.enabled} />
          <Details details={details} showHead={dict === null} />
          {dict === null && details === null && (
            <Text variant="muted">{offline ? "You're offline: looking words up needs a connection." : "No definition found."}</Text>
          )}
          {vocab.enabled && <Button kind="primary" label="Translate" onPress={() => setTranslating(true)} />}
        </>
      )}
    </Sheet>
  );
}

function Gloss({ word, dict, hasDetails, aiEnabled }: { word: string; dict: DictEntry | null | undefined; hasDetails: boolean; aiEnabled: boolean }) {
  const { colors, radii } = useTheme();
  if (dict === undefined) return <Text variant="subtle">Looking up…</Text>;
  if (dict === null) return null;
  const inflected = dict.lemma.toLowerCase() !== word.toLowerCase();
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text variant="heading">{dict.article ? `${dict.article} ${dict.lemma}` : dict.lemma}</Text>
        <SpeakButton text={dict.article ? `${dict.article} ${dict.lemma}` : dict.lemma} />
        {dict.pos ? (
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.control / 2, backgroundColor: colors.surfaceSunken }}>
            <Text style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: colors.inkMuted }}>
              {POS_LABEL[dict.pos] ?? dict.pos}
            </Text>
          </View>
        ) : null}
      </View>
      {inflected && <Text variant="subtle">from “{word}”</Text>}
      {dict.gloss ? (
        <Text>{dict.gloss}</Text>
      ) : hasDetails ? null : (
        <Text variant="subtle">{aiEnabled ? "Tap Translate for the meaning." : "No offline definition."}</Text>
      )}
      {dict.pos === "noun" && dict.plural ? <Text variant="subtle">pl. {dict.plural}</Text> : null}
      {dict.pos === "verb" && dict.partizip2 ? <Text variant="subtle">Partizip II: {dict.partizip2}</Text> : null}
    </View>
  );
}

/** Wiktionary senses under the gloss (credited: CC BY-SA). */
function Details({ details, showHead }: { details: WordDetails | null | undefined; showHead: boolean }) {
  const [all, setAll] = useState(false);
  if (details === undefined) return <Text variant="subtle">Loading definitions…</Text>;
  if (!details) return null;
  const senses = details.entries.flatMap((e) => e.senses.map((s) => ({ ...s, pos: e.pos })));
  const shown = all ? senses : senses.slice(0, 3);
  const ipa = details.entries.find((e) => e.ipa)?.ipa;
  return (
    <View style={{ gap: 6 }}>
      {showHead && <Text variant="heading">{details.word}</Text>}
      {(ipa || details.formOf) && <Text variant="subtle">{[ipa, details.formOf].filter(Boolean).join("  ")}</Text>}
      {shown.map((s, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 6 }}>
          <Text variant="subtle">{i + 1}.</Text>
          <View style={{ flex: 1 }}>
            <Text>
              {details.entries.length > 1 ? <Text variant="subtle">{(POS_LABEL[s.pos] ?? s.pos).toUpperCase()} </Text> : null}
              {s.definition}
            </Text>
            {s.examples[0] ? <Text variant="muted" style={{ fontStyle: "italic" }}>{s.examples[0]}</Text> : null}
          </View>
        </View>
      ))}
      {senses.length > shown.length && (
        <Pressable onPress={() => setAll(true)} accessibilityRole="button" hitSlop={8}>
          <Text variant="muted" style={{ textDecorationLine: "underline" }}>
            {senses.length - shown.length} more
          </Text>
        </Pressable>
      )}
      <Text variant="subtle" style={{ fontSize: 11 }}>
        Wiktionary · {details.source.license}
      </Text>
    </View>
  );
}

function TranslatePanel({
  word,
  context,
  dict,
  vocab,
  onClose,
}: {
  word: string;
  context?: string;
  dict: DictEntry | null;
  vocab: VocabState;
  onClose: () => void;
}) {
  const { colors, radii } = useTheme();
  const tr = useWordTranslation({ display: word, context, dict, vocab });
  const [newGroup, setNewGroup] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { data, fetched, loading, error, headword, inflected, savedEntry, saving } = tr;
  const ex = data?.examples?.[0];
  /** Group changes need the server (they aren't queued offline). */
  const guard = async (fn: () => Promise<void>) => {
    setProblem(null);
    try {
      await fn();
    } catch {
      setProblem("Couldn't change the groups. Groups need a connection.");
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <View>
        <Text variant="heading">{headword}</Text>
        {inflected && <Text variant="subtle">from “{word}”</Text>}
      </View>
      {loading && (
        <View style={{ gap: 2 }}>
          {dict?.gloss ? <Text>{dict.gloss}</Text> : null}
          <Text variant="subtle">Translating…</Text>
        </View>
      )}
      {error && (
        <Pressable onPress={tr.retry} accessibilityRole="button" style={{ padding: 10, borderRadius: radii.control, backgroundColor: colors.dangerSoft }}>
          <Text style={{ color: colors.danger }}>{error}</Text>
          <Text style={{ color: colors.danger, fontFamily: font.medium, textDecorationLine: "underline" }}>Try again</Text>
        </Pressable>
      )}
      {data && (
        <>
          <Text>{data.translation}</Text>
          {fetched?.pos === "verb" && fetched.partizip2 ? (
            <Text variant="subtle">
              {fetched.auxiliary ? `Perfekt: ${perfektAux(fetched.auxiliary)} ${fetched.partizip2}` : `Partizip II: ${fetched.partizip2}`}
            </Text>
          ) : null}
          {ex && (
            <View style={{ padding: 10, borderRadius: radii.control, backgroundColor: colors.surfaceSunken, gap: 2 }}>
              <Text>{ex.de}</Text>
              <Text variant="muted">{ex.en}</Text>
            </View>
          )}
          {vocab.groups.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text variant="subtle">{savedEntry ? "Groups" : "Save to group"}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {vocab.groups.map((g) => {
                  const member = savedEntry?.groups.includes(g.id) ?? false;
                  return (
                    <Pressable
                      key={g.id}
                      onPress={() => void guard(() => tr.setGroup(g.id, !member))}
                      accessibilityRole="button"
                      accessibilityState={{ selected: member }}
                      style={{
                        minHeight: 36,
                        paddingHorizontal: 12,
                        justifyContent: "center",
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: member ? "transparent" : colors.borderStrong,
                        backgroundColor: member ? colors.brandSoft : "transparent",
                      }}
                    >
                      <Text style={{ fontSize: 13, color: member ? colors.brandInk : colors.inkMuted }}>
                        {member ? "✓ " : ""}
                        {g.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput
              value={newGroup}
              onChangeText={setNewGroup}
              placeholder="New group"
              placeholderTextColor={colors.inkSubtle}
              style={{
                flex: 1,
                minHeight: 40,
                paddingHorizontal: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: colors.borderStrong,
                color: colors.ink,
                fontFamily: font.regular,
              }}
            />
            {newGroup.trim() ? (
              <Pressable
                onPress={() => void guard(async () => (await tr.addToNewGroup(newGroup), setNewGroup("")))}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={{ fontFamily: font.medium, color: colors.brandInk }}>Add</Text>
              </Pressable>
            ) : null}
          </View>
          {problem && <Text style={{ color: colors.danger }}>{problem}</Text>}
          {savedEntry ? (
            <Button
              kind="primary"
              label="Saved · open Vocab"
              onPress={() => {
                onClose();
                router.navigate("/vocab");
              }}
            />
          ) : (
            <Button kind="primary" label={saving ? "Adding…" : "Add to vocab"} busy={saving} onPress={() => void tr.add()} />
          )}
        </>
      )}
    </View>
  );
}
