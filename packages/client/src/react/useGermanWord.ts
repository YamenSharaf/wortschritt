import { useEffect, useRef, useState } from "react";
import type { GermanWord } from "@mdb/shared";
import { presetAsGerman } from "../englishWords";
import { useApi } from "./context";

/** A tapped English word in a translation exercise. */
export type TappedWord = { text: string; preset?: { en: string; de: string } };

export type GermanWordState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; results: GermanWord[]; source: "item" | "glossary" | "tutor" }
  | { status: "error"; message: string };

/**
 * The German for a tapped English word: the item's own meaning when it has
 * one, else the curated glossary, else the tutor (in the sense the sentence
 * uses). A glossary answer can still be asked of the tutor. Saving puts the
 * German in the learner's vocab with the English as its meaning.
 */
export function useGermanWord(word: TappedWord | null, sentence: string) {
  const api = useApi();
  const [state, setState] = useState<GermanWordState>({ status: "idle" });
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const seq = useRef(0);

  const askTutor = async (w: string, n: number) => {
    setState({ status: "loading" });
    try {
      const r = await api.germanWord(w, sentence);
      if (n === seq.current) setState({ status: "ready", results: [r], source: "tutor" });
    } catch (e) {
      if (n !== seq.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setState({ status: "error", message: /not set up|503/i.test(msg) ? "No German for this word here, and no AI tutor to ask." : msg });
    }
  };

  useEffect(() => {
    const n = ++seq.current;
    if (!word) return setState({ status: "idle" });
    if (word.preset) return setState({ status: "ready", results: [presetAsGerman(word.preset)], source: "item" });
    setState({ status: "loading" });
    api
      .germanFromGlossary(word.text)
      .then((results) => {
        if (n !== seq.current) return;
        if (results.length) setState({ status: "ready", results, source: "glossary" });
        else void askTutor(word.text, n);
      })
      .catch(() => n === seq.current && void askTutor(word.text, n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word?.text, word?.preset?.de, sentence]);

  return {
    state,
    /** Ask the tutor even though the glossary had something. */
    askTutor: () => word && void askTutor(word.text, seq.current),
    isSaved: (g: GermanWord) => saved.has(g.lemma.toLowerCase()),
    async save(g: GermanWord) {
      await api.vocabSave({
        word: g.lemma,
        display: g.lemma,
        translation: g.en.replace(/^\((sich)\)\s*/, ""),
        examples: [],
        ...(g.pos || g.article ? { forms: { ...(g.pos ? { pos: g.pos } : {}), ...(g.article ? { article: g.article } : {}) } } : {}),
      });
      setSaved((s) => new Set(s).add(g.lemma.toLowerCase()));
    },
  };
}
