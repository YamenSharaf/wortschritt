import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, TextInput, View, type TextInputProps } from "react-native";
import {
  gradeText,
  isCanonical,
  isOpenAnswer,
  modelAnswer,
  type AnswerVerdict,
  type ExerciseItem,
  type ItemResponse,
  type TextAnswer,
} from "@mdb/shared";
import { font, useTheme } from "@/lib/theme";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/icons";
import { Text } from "@/ui/Text";
import { englishParts, wordDiff } from "@mdb/client";
import { useGermanWord, type TappedWord } from "@mdb/client/react";
import { Check, Lightbulb, Quote, X } from "lucide-react-native";

/**
 * One renderer per exercise type, as on the web (components/ExerciseItemView):
 * the item is shown, what the learner answers goes to `submit` once, and the
 * verdict that comes back (the server's, or offline a provisional one) is
 * only rendered. Adding a type = a case here and a schema in @mdb/shared.
 */
type Submit = (response: ItemResponse) => Promise<AnswerVerdict>;

export function ItemView({ item, submit }: { item: ExerciseItem; submit: Submit }) {
  switch (item.type) {
    case "multiple_choice":
      return <MultipleChoice item={item} submit={submit} />;
    case "cloze":
      return <Cloze item={item} submit={submit} />;
    case "flashcard":
      return <Flashcard item={item} submit={submit} />;
    case "sentence_build":
      return <SentenceBuild item={item} submit={submit} />;
    case "transform":
      return <Transform item={item} submit={submit} />;
    case "true_false":
      return <TrueFalse item={item} submit={submit} />;
    case "conjugation_table":
      return <ConjugationTable item={item} submit={submit} />;
    case "translate":
      return <Translate item={item} submit={submit} />;
  }
}

// --- shared bits -------------------------------------------------------------

/** German answers are often lowercase mid-sentence: no forced capitals or "corrections". */
const answerInput: TextInputProps = {
  autoCapitalize: "none",
  autoCorrect: false,
  autoComplete: "off",
  spellCheck: false,
};

function Instructions({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <View style={{ marginBottom: 16 }}>
      <Text variant="eyebrow">Task</Text>
      <Text variant="muted">{text}</Text>
    </View>
  );
}

function Context({ text }: { text?: string }) {
  const { colors } = useTheme();
  if (!text) return null;
  return (
    <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
      <View style={{ marginTop: 4 }}>
        <Icon icon={Quote} size={16} color={colors.inkSubtle} />
      </View>
      <Text variant="muted" style={{ flex: 1, fontSize: 16, lineHeight: 24 }}>
        {text}
      </Text>
    </View>
  );
}

/** A list of words ("Wörter: ich · sich · waschen") becomes a word bank; anything else a quiet line. */
function ItemHint({ text }: { text?: string }) {
  const { colors } = useTheme();
  if (!text) return null;
  const m = /^([^:·]{1,20}):\s*(.+)$/.exec(text);
  const label = m ? m[1]!.trim() : "Words";
  const words = (m ? m[2]! : text).split("·").map((w) => w.trim()).filter(Boolean);
  if (words.length < 2)
    return (
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <Icon icon={Lightbulb} size={16} color={colors.inkSubtle} />
        <Text variant="muted" style={{ flex: 1, fontSize: 14 }}>
          {text}
        </Text>
      </View>
    );
  return (
    <View style={{ marginBottom: 16, gap: 6 }}>
      <Text variant="eyebrow">{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {words.map((w, i) => (
          <View key={i} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderControl }}>
            <Text style={{ fontFamily: font.medium, fontSize: 14 }}>{w}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Explanation({ text }: { text?: string }) {
  const { colors } = useTheme();
  if (!text) return null;
  return (
    <View style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border, gap: 4 }}>
      <Text variant="eyebrow">Why</Text>
      <Text variant="muted" style={{ fontSize: 14, lineHeight: 22 }}>
        {text}
      </Text>
    </View>
  );
}

function Prompt({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 17, lineHeight: 28, marginBottom: 16 }}>{children}</Text>;
}

/** Submit once and keep the verdict; a failed submission shows as an error. */
function useVerdict(submit: Submit) {
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<AnswerVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function send(r: ItemResponse) {
    setBusy(true);
    setError(null);
    try {
      setVerdict(await submit(r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check the answer.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, verdict, error, send };
}

type ChoiceState = "idle" | "correct" | "wrong";

/** A choice button; its verdict is a mark as well as a colour (e-ink, colour blindness). */
function Choice({ label, state, disabled, onPress }: { label: string; state: ChoiceState; disabled: boolean; onPress: () => void }) {
  const { colors, radii } = useTheme();
  const bg = state === "correct" ? colors.successSoft : state === "wrong" ? colors.dangerSoft : colors.surface;
  const fg = state === "correct" ? colors.success : state === "wrong" ? colors.danger : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={state === "idle" ? label : `${label}, ${state === "correct" ? "right answer" : "your answer, wrong"}`}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: radii.control,
        borderWidth: 1,
        borderColor: state === "idle" ? colors.borderControl : "transparent",
        backgroundColor: pressed && state === "idle" ? colors.surfaceSunken : bg,
        opacity: disabled && state === "idle" ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          flex: 1,
          color: fg,
          fontFamily: state === "correct" ? font.medium : font.regular,
          textDecorationLine: state === "wrong" ? "line-through" : "none",
        }}
      >
        {label}
      </Text>
      {state !== "idle" && <Icon icon={state === "correct" ? Check : X} size={18} color={fg} />}
    </Pressable>
  );
}

/**
 * An answer box. Uncontrolled: what's typed stays in the native field and is
 * only reported (`onChangeText`); handing every keystroke back as `value`
 * makes typing lag on Android. Each item mounts fresh, so it starts empty.
 */
function AnswerField(props: TextInputProps & { state?: ChoiceState; width?: number }) {
  const { colors, radii } = useTheme();
  const { state = "idle", width, style, value, ...rest } = props;
  return (
    <TextInput
      {...answerInput}
      placeholderTextColor={colors.inkSubtle}
      defaultValue={value}
      {...rest}
      style={[
        {
          minHeight: 44,
          width,
          paddingHorizontal: 12,
          borderRadius: radii.control,
          borderWidth: 1,
          borderColor: state === "idle" ? colors.borderControl : "transparent",
          backgroundColor: state === "correct" ? colors.successSoft : state === "wrong" ? colors.dangerSoft : colors.surfaceSunken,
          color: state === "correct" ? colors.success : state === "wrong" ? colors.danger : colors.ink,
          fontFamily: font.medium,
          fontSize: 16,
          textDecorationLine: state === "wrong" ? "line-through" : "none",
        },
        style,
      ]}
    />
  );
}

function OpenAnswerBadge({ answer }: { answer: TextAnswer }) {
  const { colors } = useTheme();
  if (!isOpenAnswer(answer)) return null;
  return (
    <View style={{ alignSelf: "flex-start", marginBottom: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSunken }}>
      <Text style={{ fontSize: 12, fontFamily: font.medium, color: colors.inkMuted }}>Open answer: any correct answer counts</Text>
    </View>
  );
}

function ResultBanner({ verdict, answer, input }: { verdict: AnswerVerdict; answer: TextAnswer; input: string }) {
  const { colors, radii } = useTheme();
  const open = isOpenAnswer(answer);
  const result = verdict.correct;
  const showAnswer = !open && (!result || !isCanonical(input, answer));
  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      {verdict.grading !== "ungraded" && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: radii.control,
            backgroundColor: result ? colors.successSoft : colors.dangerSoft,
          }}
        >
          <Icon icon={result ? Check : X} size={16} color={result ? colors.success : colors.danger} />
          <Text style={{ fontFamily: font.semibold, color: result ? colors.success : colors.danger }}>{result ? "Correct." : "Not quite."}</Text>
        </View>
      )}
      {open && (
        <View style={{ gap: 2 }}>
          <Text variant="eyebrow">Possible answers</Text>
          {answer.accept.map((a) => (
            <Text key={a} style={{ fontFamily: font.medium }}>
              {a}
            </Text>
          ))}
        </View>
      )}
      {showAnswer && (
        <Text>
          <Text variant="muted">Answer: </Text>
          <Text style={{ fontFamily: font.medium }}>{modelAnswer(answer)}</Text>
        </Text>
      )}
      {verdict.feedback ? <Text variant="muted">{verdict.feedback}</Text> : null}
    </View>
  );
}

function CheckButton({ onPress, busy, disabled }: { onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: "row", marginTop: 16 }}>
      <Button kind="primary" label={busy ? "Checking…" : "Check"} busy={busy} disabled={disabled} onPress={onPress} />
    </View>
  );
}

// --- multiple choice / true-false ----------------------------------------------

function MultipleChoice({ item, submit }: { item: Extract<ExerciseItem, { type: "multiple_choice" }>; submit: Submit }) {
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;
  return (
    <View>
      <Instructions text={item.instructions} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <Prompt>{item.prompt}</Prompt>
      <View style={{ gap: 8 }}>
        {item.choices.map((choice, i) => (
          <Choice
            key={i}
            label={choice}
            disabled={done}
            state={!done ? "idle" : i === item.answerIndex ? "correct" : i === picked ? "wrong" : "idle"}
            onPress={() => {
              setPicked(i);
              void submit({ type: "multiple_choice", choice: i });
            }}
          />
        ))}
      </View>
      {done && <Explanation text={item.explanation} />}
    </View>
  );
}

function TrueFalse({ item, submit }: { item: Extract<ExerciseItem, { type: "true_false" }>; submit: Submit }) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState<boolean | null>(null);
  const done = picked !== null;
  return (
    <View>
      <Instructions text={item.instructions ?? "Correct or incorrect?"} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <Prompt>{item.statement}</Prompt>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[
          { label: "Correct", value: true },
          { label: "Incorrect", value: false },
        ].map((o) => (
          <View key={o.label} style={{ flex: 1 }}>
            <Choice
              label={o.label}
              disabled={done}
              state={!done ? "idle" : o.value === item.correct ? "correct" : o.value === picked ? "wrong" : "idle"}
              onPress={() => {
                setPicked(o.value);
                void submit({ type: "true_false", value: o.value });
              }}
            />
          </View>
        ))}
      </View>
      {done && item.correction ? (
        <Text style={{ marginTop: 12 }}>
          <Text variant="muted">Correct form: </Text>
          <Text style={{ fontFamily: font.semibold, color: colors.success }}>{item.correction}</Text>
        </Text>
      ) : null}
      {done && <Explanation text={item.explanation} />}
    </View>
  );
}

// --- cloze -------------------------------------------------------------------

type Segment = { kind: "text"; value: string } | { kind: "blank"; ref: string };

function Cloze({ item, submit }: { item: Extract<ExerciseItem, { type: "cloze" }>; submit: Submit }) {
  const { colors } = useTheme();
  const segments = useMemo<Segment[]>(() => {
    const out: Segment[] = [];
    const re = /\{\{\s*([^}]+?)\s*\}\}/g;
    let last = 0;
    for (const m of item.text.matchAll(re)) {
      if (m.index! > last) out.push({ kind: "text", value: item.text.slice(last, m.index) });
      out.push({ kind: "blank", ref: m[1]! });
      last = m.index! + m[0].length;
    }
    if (last < item.text.length) out.push({ kind: "text", value: item.text.slice(last) });
    return out;
  }, [item.text]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const byRef = useMemo(() => Object.fromEntries(item.blanks.map((b) => [b.ref, b])), [item.blanks]);

  function check() {
    setDone(true);
    void submit({ type: "cloze", blanks: Object.fromEntries(item.blanks.map((b) => [b.ref, values[b.ref] ?? ""])) });
  }

  return (
    <View>
      <Instructions text={item.instructions} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      {/* The sentence wraps around its gaps (text pieces word by word, so lines break naturally). */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 8 }}>
        {segments.map((seg, i) => {
          if (seg.kind === "text")
            return seg.value.split(/(\s+)/).map((w, j) =>
              w.trim() ? (
                <Text key={`${i}-${j}`} style={{ fontSize: 18, lineHeight: 30 }}>
                  {w}
                </Text>
              ) : (
                <Text key={`${i}-${j}`} style={{ fontSize: 18 }}>
                  {" "}
                </Text>
              ),
            );
          const blank = byRef[seg.ref];
          const value = values[seg.ref] ?? "";
          const ok = blank ? gradeText(value, blank.answer) : false;
          return (
            <View key={i} style={{ alignItems: "center", marginHorizontal: 4 }}>
              <AnswerField
                value={value}
                editable={!done}
                placeholder={blank?.cue || "…"}
                onChangeText={(t) => setValues((v) => ({ ...v, [seg.ref]: t }))}
                onSubmitEditing={() => !done && check()}
                state={!done ? "idle" : ok ? "correct" : "wrong"}
                width={128}
                style={{ textAlign: "center", minHeight: 40 }}
              />
              {blank?.cue && !done ? <Text variant="subtle">({blank.cue})</Text> : null}
              {done && blank && !isCanonical(value, blank.answer) ? (
                <Text style={{ fontSize: 12, fontFamily: font.semibold, color: colors.ink }}>{modelAnswer(blank.answer)}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {!done ? <CheckButton onPress={check} /> : <Explanation text={item.explanation} />}
    </View>
  );
}

// --- flashcard ---------------------------------------------------------------

function Flashcard({ item, submit }: { item: Extract<ExerciseItem, { type: "flashcard" }>; submit: Submit }) {
  const { colors, radii } = useTheme();
  const [flipped, setFlipped] = useState(false);
  const [rated, setRated] = useState(false);
  const rate = (knew: boolean) => {
    setRated(true);
    void submit({ type: "flashcard", knew });
  };
  return (
    <View>
      <Instructions text={item.instructions} />
      <Context text={item.context} />
      <Pressable
        onPress={() => setFlipped((f) => !f)}
        accessibilityRole="button"
        accessibilityHint="Flips the card"
        style={{
          minHeight: 176,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          borderRadius: radii.panel,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Text style={{ fontFamily: font.semibold, fontSize: 28, lineHeight: 36, letterSpacing: -0.56, textAlign: "center" }}>
          {flipped ? item.back : item.front}
        </Text>
      </Pressable>
      {!flipped && (
        <Text variant="subtle" style={{ textAlign: "center", marginTop: 8 }}>
          Tap to flip
        </Text>
      )}
      {flipped && !rated && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Button label="Didn't know" icon={<Icon icon={X} size={16} />} onPress={() => rate(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button kind="primary" label="Knew it" icon={<Icon icon={Check} size={16} color={colors.brandInk} />} onPress={() => rate(true)} />
          </View>
        </View>
      )}
      {rated && <Explanation text={item.explanation} />}
    </View>
  );
}

// --- sentence build / transform ----------------------------------------------

function SentenceBuild({ item, submit }: { item: Extract<ExerciseItem, { type: "sentence_build" }>; submit: Submit }) {
  const { colors, radii } = useTheme();
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const { busy, verdict, error, send } = useVerdict(submit);
  const tokens = item.tokens ?? [];
  const hasBank = tokens.length > 0;
  const remaining = tokens.map((_, i) => i).filter((i) => !chosen.includes(i));
  const built = hasBank ? chosen.map((i) => tokens[i]).join(" ") : text;
  const locked = verdict !== null;
  const check = () => void send({ type: "sentence_build", text: built });

  const chip = (label: string, onPress: () => void, picked: boolean, key: number) => (
    <Pressable
      key={key}
      onPress={onPress}
      disabled={locked}
      accessibilityRole="button"
      style={{
        minHeight: 40,
        paddingHorizontal: 12,
        justifyContent: "center",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: picked ? "transparent" : colors.borderControl,
        backgroundColor: picked ? colors.brandSoft : colors.surface,
      }}
    >
      <Text style={{ fontFamily: picked ? font.medium : font.regular, color: picked ? colors.brandInk : colors.ink }}>{label}</Text>
    </Pressable>
  );

  return (
    <View>
      <Instructions text={item.instructions ?? "Put the words in the correct order."} />
      <OpenAnswerBadge answer={item.answer} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      {hasBank ? (
        <>
          <View
            style={{
              minHeight: 56,
              marginBottom: 12,
              padding: 8,
              borderRadius: radii.control,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: colors.borderControl,
              backgroundColor: colors.surfaceSunken,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {chosen.map((t, pos) => chip(tokens[t]!, () => setChosen((c) => c.filter((_, i) => i !== pos)), true, pos))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {remaining.map((i) => chip(tokens[i]!, () => setChosen((c) => [...c, i]), false, i))}
          </View>
        </>
      ) : (
        <AnswerField value={text} editable={!locked} onChangeText={setText} onSubmitEditing={() => !locked && text.trim() && check()} placeholder="Type the sentence…" />
      )}
      {!locked && <CheckButton onPress={check} busy={busy} disabled={hasBank ? chosen.length === 0 : !text.trim()} />}
      {error ? <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text> : null}
      {verdict && (
        <>
          <ResultBanner verdict={verdict} answer={item.answer} input={built} />
          <Explanation text={item.explanation} />
        </>
      )}
    </View>
  );
}

function Transform({ item, submit }: { item: Extract<ExerciseItem, { type: "transform" }>; submit: Submit }) {
  const { colors } = useTheme();
  const [text, setText] = useState("");
  const { busy, verdict, error, send } = useVerdict(submit);
  // A given sentence on the first line, a lead-in to complete on the next.
  const [given, ...rest] = item.source.split("\n").map((s) => s.trim());
  const lead = rest.filter(Boolean).join(" ");
  const check = () => void send({ type: "transform", text });
  return (
    <View>
      <Instructions text={item.instructions} />
      <OpenAnswerBadge answer={item.answer} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <Prompt>{given}</Prompt>
      {lead ? <Text style={{ fontSize: 18, lineHeight: 28, marginBottom: 12 }}>{lead}</Text> : null}
      <AnswerField value={text} editable={verdict === null} onChangeText={setText} onSubmitEditing={() => verdict === null && text.trim() && check()} placeholder="Your answer…" />
      {verdict === null && <CheckButton onPress={check} busy={busy} disabled={!text.trim()} />}
      {error ? <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text> : null}
      {verdict && (
        <>
          <ResultBanner verdict={verdict} answer={item.answer} input={text} />
          <Explanation text={item.explanation} />
        </>
      )}
    </View>
  );
}

// --- translate -----------------------------------------------------------------

function Translate({ item, submit }: { item: Extract<ExerciseItem, { type: "translate" }>; submit: Submit }) {
  const { colors, radii } = useTheme();
  const [text, setText] = useState("");
  const { busy, verdict, error, send } = useVerdict(submit);
  const check = () => void send({ type: "translate", text });
  return (
    <View>
      <Instructions text={item.instructions ?? "Translate into German."} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <Text variant="eyebrow">English</Text>
      <EnglishSentence item={item} />
      <AnswerField
        value={text}
        editable={verdict === null}
        onChangeText={setText}
        multiline
        submitBehavior="submit"
        returnKeyType="done"
        onSubmitEditing={() => verdict === null && text.trim() && check()}
        placeholder="Auf Deutsch…"
        style={{ minHeight: 72, paddingVertical: 10, textAlignVertical: "top", lineHeight: 24 }}
      />
      {verdict === null && <CheckButton onPress={check} busy={busy} disabled={!text.trim()} />}
      {error ? <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text> : null}
      {verdict && (
        <>
          <TranslationVerdict verdict={verdict} item={item} input={text} />
          <Explanation text={item.explanation} />
        </>
      )}
    </View>
  );
}

/**
 * The English sentence, every word tappable for its German: the item's own
 * words underlined (and listed, quieter, below), the rest looked up in the
 * glossary or asked of the tutor. The answer shows in a card under it.
 */
function EnglishSentence({ item }: { item: Extract<ExerciseItem, { type: "translate" }> }) {
  const { colors, radii } = useTheme();
  const [tapped, setTapped] = useState<TappedWord | null>(null);
  const parts = useMemo(() => englishParts(item.english, item.words), [item.english, item.words]);
  const toggle = (w: TappedWord) => setTapped((t) => (t?.text === w.text ? null : w));
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 19, lineHeight: 32 }}>
        {parts.map((p, i) =>
          p.kind === "text" ? (
            <Text key={i}>{p.text}</Text>
          ) : (
            <Text
              key={i}
              suppressHighlighting
              onPress={() => toggle({ text: p.text, ...(p.preset ? { preset: p.preset } : {}) })}
              style={[
                tapped?.text === p.text && { backgroundColor: colors.brandSoft },
                p.preset && { textDecorationLine: "underline", textDecorationStyle: "dotted", textDecorationColor: colors.inkSubtle },
              ]}
            >
              {p.text}
            </Text>
          ),
        )}
      </Text>
      {tapped && <GermanWordCard word={tapped} sentence={item.english} onClose={() => setTapped(null)} />}
      {item.words?.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {item.words.map((w) => (
            <Pressable
              key={w.en}
              onPress={() => toggle({ text: w.en, preset: w })}
              style={{ flexDirection: "row", gap: 4, alignItems: "center", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.control, borderWidth: 1, borderColor: colors.border }}
            >
              <Text variant="muted" style={{ fontSize: 12 }}>
                {w.en}
              </Text>
              <Text style={{ fontSize: 12, color: colors.inkSubtle }}>→</Text>
              <Text style={{ fontSize: 12, fontFamily: font.medium }}>{w.de}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function GermanWordCard({ word, sentence, onClose }: { word: TappedWord; sentence: string; onClose: () => void }) {
  const { colors, radii } = useTheme();
  const { state, askTutor, save, isSaved } = useGermanWord(word, sentence);
  return (
    <View style={{ marginTop: 8, padding: 12, borderRadius: radii.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSunken, flexDirection: "row", gap: 12 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="muted" style={{ fontSize: 14 }}>
          {word.text}
          {state.status === "loading" ? <Text style={{ color: colors.inkSubtle }}>  Looking it up…</Text> : null}
        </Text>
        {state.status === "error" ? <Text variant="muted" style={{ fontSize: 14 }}>{state.message}</Text> : null}
        {state.status === "ready"
          ? state.results.map((g) => (
              <View key={g.de} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 12, rowGap: 2 }}>
                <Text style={{ fontSize: 17, fontFamily: font.semibold }}>{g.de}</Text>
                {state.source === "glossary" ? <Text style={{ fontSize: 12, color: colors.inkSubtle }}>{g.en}</Text> : null}
                <Pressable disabled={isSaved(g)} onPress={() => void save(g)} hitSlop={8}>
                  <Text style={{ fontSize: 13, fontFamily: font.medium, color: isSaved(g) ? colors.inkSubtle : colors.brandInk }}>{isSaved(g) ? "Saved" : "Save to vocab"}</Text>
                </Pressable>
              </View>
            ))
          : null}
        {state.status === "ready" && state.source === "glossary" ? (
          <Pressable onPress={askTutor} hitSlop={8}>
            <Text variant="muted" style={{ fontSize: 13 }}>
              Not this sense? Ask the tutor
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={10}>
        <Icon icon={X} size={16} color={colors.inkSubtle} />
      </Pressable>
    </View>
  );
}

/** Right, almost or wrong; the learner's sentence corrected (what changed marked); another way to say it. */
function TranslationVerdict({ verdict, item, input }: { verdict: AnswerVerdict; item: Extract<ExerciseItem, { type: "translate" }>; input: string }) {
  const { colors, radii } = useTheme();
  const fg = verdict.correct ? colors.success : verdict.almost ? colors.warning : colors.danger;
  const bg = verdict.correct ? colors.successSoft : verdict.almost ? colors.warningSoft : colors.dangerSoft;
  const showModel = !isCanonical(input, item.answer);
  return (
    <View style={{ marginTop: 12, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.control, backgroundColor: bg }}>
        <Icon icon={verdict.correct ? Check : X} size={16} color={fg} />
        <Text style={{ fontFamily: font.semibold, color: fg }}>{verdict.correct ? "Correct." : verdict.almost ? "Almost." : "Not quite."}</Text>
      </View>
      {verdict.corrected ? (
        <View>
          <Text variant="eyebrow">Your sentence, corrected</Text>
          <Text style={{ fontSize: 16, lineHeight: 26 }}>
            {wordDiff(input, verdict.corrected).map((part, i) => (
              <Text key={i}>
                {part.gap ? " " : ""}
                {part.kind === "same" ? (
                  part.text
                ) : (
                  <Text
                    style={
                      part.kind === "added"
                        ? { fontFamily: font.semibold, color: colors.success, backgroundColor: colors.successSoft }
                        : { color: colors.danger, textDecorationLine: "line-through" }
                    }
                  >
                    {part.text}
                  </Text>
                )}
              </Text>
            ))}
          </Text>
        </View>
      ) : null}
      {verdict.feedback ? <Text variant="muted">{verdict.feedback}</Text> : null}
      {showModel && (
        <Text>
          <Text variant="muted">{verdict.correct ? "Also: " : "Model answer: "}</Text>
          <Text style={{ fontFamily: font.medium }}>{modelAnswer(item.answer)}</Text>
        </Text>
      )}
      {!verdict.correct &&
        verdict.grading !== "ai" &&
        item.answer.accept.slice(1).map((alt) => (
          <Text key={alt}>
            <Text variant="muted">Or: </Text>
            <Text style={{ fontFamily: font.medium }}>{alt}</Text>
          </Text>
        ))}
    </View>
  );
}

// --- conjugation table -------------------------------------------------------

function ConjugationTable({ item, submit }: { item: Extract<ExerciseItem, { type: "conjugation_table" }>; submit: Submit }) {
  const { colors } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const key = (c: number, r: number) => `${c}:${r}`;
  const ok = (c: number, r: number) => gradeText(values[key(c, r)] ?? "", { accept: [item.columns[c]?.answers[r] ?? ""], grading: "normalized" });
  function check() {
    setDone(true);
    void submit({ type: "conjugation_table", cells: item.columns.map((_, c) => item.rows.map((_, r) => values[key(c, r)] ?? "")) });
  }
  return (
    <View>
      <Instructions text={item.instructions ?? "Fill in the conjugations."} />
      <Context text={item.context} />
      <ItemHint text={item.hint} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <View style={{ width: 72 }} />
            {item.columns.map((col) => (
              <Text key={col.header} style={{ width: 120, fontFamily: font.semibold }}>
                {col.header}
              </Text>
            ))}
          </View>
          {item.rows.map((row, r) => (
            <View key={row} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
              <Text variant="muted" style={{ width: 72, paddingTop: 10 }}>
                {row}
              </Text>
              {item.columns.map((col, c) => (
                <View key={col.header} style={{ width: 120 }}>
                  <AnswerField
                    value={values[key(c, r)] ?? ""}
                    editable={!done}
                    onChangeText={(t) => setValues((v) => ({ ...v, [key(c, r)]: t }))}
                    state={!done ? "idle" : ok(c, r) ? "correct" : "wrong"}
                    style={{ minHeight: 40 }}
                  />
                  {done && !ok(c, r) ? (
                    <Text style={{ fontSize: 12, fontFamily: font.semibold, color: colors.ink, marginTop: 2 }}>{col.answers[r]}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {!done ? <CheckButton onPress={check} /> : <Explanation text={item.explanation} />}
    </View>
  );
}
