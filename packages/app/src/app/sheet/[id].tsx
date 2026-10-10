import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useApi, useAssistantEnabled, useAsync, useVocabState } from "@mdb/client/react";
import { useSync } from "@/lib/sync";
import { font, useTheme } from "@/lib/theme";
import { WordSheet } from "@/reader/WordSheet";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Icon } from "@/ui/icons";
import { Markdown } from "@/ui/Markdown";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { ChevronLeft, Languages } from "lucide-react-native";

/** One cheat sheet: its sections, each word tappable, each section translatable (as on the web). */
export default function SheetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const { colors } = useTheme();
  const sheet = useAsync(() => api.cheatsheet(id), [api, id]);
  const assistant = useAssistantEnabled();
  const vocab = useVocabState();
  const [word, setWord] = useState<{ word: string; context: string } | null>(null);

  // Log the view so it shows under "Recently viewed" on Home.
  const ready = sheet.status === "ready" ? sheet.data : null;
  useEffect(() => {
    if (ready) void api.recordSheetView(ready.id, ready.title).catch(() => {});
  }, [api, ready?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen dock={false}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 }}>
        <Icon icon={ChevronLeft} size={18} color={colors.inkMuted} />
        <Text style={{ fontFamily: font.medium, color: colors.inkMuted }}>Cheat sheets</Text>
      </Pressable>
      {sheet.status === "loading" && <Text variant="muted">Loading…</Text>}
      {sheet.status === "error" && <Text style={{ color: colors.danger }}>This cheat sheet isn't here.</Text>}
      {ready && (
        <>
          <View>
            <Text variant="title">{ready.title}</Text>
            {ready.subtitle ? <Text variant="muted">{ready.subtitle}</Text> : null}
          </View>
          {ready.sections.map((sec, i) => (
            <Section key={i} heading={sec.heading} body={sec.body} canTranslate={assistant} onWord={(w, context) => setWord({ word: w, context })} />
          ))}
        </>
      )}
      {word && <WordSheet word={word.word} context={word.context} vocab={vocab} onClose={() => setWord(null)} />}
    </Screen>
  );
}

function Section({ heading, body, canTranslate, onWord }: { heading: string; body: string; canTranslate: boolean; onWord: (w: string, context: string) => void }) {
  const api = useApi();
  const { colors, radii } = useTheme();
  const offline = useSync().status.state === "offline";
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  function translate() {
    abort.current?.abort();
    if (text !== null) {
      setText(null);
      setBusy(false);
      setError(null);
      return;
    }
    const c = new AbortController();
    abort.current = c;
    setBusy(true);
    setError(null);
    setText("");
    api
      .askAssistant({ task: "translate_sheet", text: body }, (t) => setText((s) => (s ?? "") + t), c.signal)
      .catch((e) => {
        if (!c.signal.aborted) setError(offline ? "Translating needs a connection." : e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  }

  return (
    <Card style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <Text variant="heading" style={{ flex: 1 }}>
          {heading}
        </Text>
        {canTranslate && (
          <Button label={text !== null ? "Hide" : "Translate"} icon={text === null ? <Icon icon={Languages} size={16} /> : undefined} onPress={translate} />
        )}
      </View>
      <Markdown text={body} onWord={onWord} />
      {(busy || text || error) && (
        <View style={{ padding: 12, borderRadius: radii.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSunken }}>
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : text ? <Markdown text={text} /> : <Text variant="subtle">Translating…</Text>}
        </View>
      )}
    </Card>
  );
}
