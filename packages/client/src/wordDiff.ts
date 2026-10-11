/**
 * What changed between a learner's sentence and its correction, word by word:
 * `same` words, words the correction `added` (or changed to), and the
 * learner's words it `removed`. Punctuation is its own token, so a moved
 * word doesn't drag the full stop along; case counts, since it matters in
 * German. `gap`: a space goes before the part.
 */
export type DiffPart = { kind: "same" | "added" | "removed"; text: string; gap: boolean };

const tokens = (s: string) => s.match(/[\p{L}\p{N}'’-]+|[^\s\p{L}\p{N}'’-]/gu) ?? [];
const isPunct = (t: string) => !/[\p{L}\p{N}]/u.test(t);

export function wordDiff(from: string, to: string): DiffPart[] {
  const a = tokens(from);
  const b = tokens(to);
  // Longest common subsequence table, from the end.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], t: string) => {
    const last = out[out.length - 1];
    const space = out.length > 0 && !isPunct(t);
    if (last?.kind === kind) last.text += (space ? " " : "") + t;
    else out.push({ kind, text: t, gap: space });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push("removed", a[i++]!);
    else push("added", b[j++]!);
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);
  return out;
}

/** The parts as plain text (for tests and screen readers): `which` side of the change. */
export function diffText(parts: DiffPart[], which: "from" | "to"): string {
  return parts
    .filter((p) => p.kind === "same" || p.kind === (which === "to" ? "added" : "removed"))
    .map((p, i) => (i > 0 && p.gap ? " " : "") + p.text)
    .join("");
}
