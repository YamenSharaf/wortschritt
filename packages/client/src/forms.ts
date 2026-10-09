import type { VocabForms } from "@mdb/shared";

/** 3rd-person perfect auxiliary from the stored lemma: haben → hat, sein → ist. */
export function perfektAux(auxiliary?: string | null): "hat" | "ist" {
  return auxiliary && /sein|ist/i.test(auxiliary) ? "ist" : "hat";
}

/** Human labels for a word's grammatical forms, or [] when none apply. */
export function formChips(forms: VocabForms | null): [string, string][] {
  if (!forms) return [];
  const chips: [string, string][] = [];
  if (forms.pos === "verb" && forms.partizip2) {
    chips.push(
      forms.auxiliary
        ? ["Perfekt", `${perfektAux(forms.auxiliary)} ${forms.partizip2}`]
        : ["Partizip II", forms.partizip2],
    );
  }
  if (forms.pos === "noun") {
    if (forms.article) chips.push(["Artikel", forms.article]);
    if (forms.plural) chips.push(["Plural", forms.plural]);
  }
  return chips;
}
