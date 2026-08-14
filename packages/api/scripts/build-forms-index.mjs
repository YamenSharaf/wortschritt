// Regenerates packages/api/assets/dict-forms.tsv.gz — the offline form→lemma
// index used by the bundled dictionary (services/dict.ts).
//
// Source data is the RosaeNLG German morphology set (Wiktionary/DWDS-derived).
// Those packages are intentionally NOT project dependencies — the generated
// asset is committed, so the runtime image stays lean. To regenerate:
//
//   npm i german-verbs-dict german-words-dict   # ad hoc, anywhere resolvable
//   node packages/api/scripts/build-forms-index.mjs
//
// Output columns: form \t lemma \t pos \t gender(M/F/N) \t plural
// When several lemmas share a form we keep the best: a form that IS a lemma
// wins, then the shortest lemma (base verb over separable-prefixed), then verbs
// over nouns. That resolves e.g. trifft→treffen (not antreffen), ging→gehen.

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const verbs = require("german-verbs-dict/dist/verbs.json");
const words = require("german-words-dict/dist/words.json");

const norm = (s) => s.normalize("NFC").trim().toLowerCase();
const cand = new Map();
function add(form, lemma, pos, gender = "", plural = "") {
  const f = norm(form);
  if (!f || f.includes(" ")) return; // skip multiword (separable) leaves
  const list = cand.get(f) || [];
  list.push({ lemma, pos, gender, plural });
  cand.set(f, list);
}

for (const [inf, data] of Object.entries(verbs)) {
  add(inf, inf, "verb");
  const walk = (o) => {
    if (o == null) return;
    if (typeof o === "string") return add(o, inf, "verb");
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o === "object") Object.values(o).forEach(walk);
  };
  for (const k of ["PRÄ", "PRT", "KJ1", "KJ2", "IMP", "PA1", "PA2"]) walk(data[k]);
}

const artMap = { M: "der", F: "die", N: "das" };
for (const [lemma, d] of Object.entries(words)) {
  if (!d || !d.NOM) continue; // entries with a nominative are nouns
  const gender = artMap[d.G] ? d.G : "";
  const plural = (d.NOM && d.NOM.PLU) || "";
  for (const c of ["NOM", "AKK", "DAT", "GEN"]) {
    const cell = d[c];
    if (!cell) continue;
    for (const n of ["SIN", "PLU"]) if (cell[n]) add(cell[n], lemma, "noun", gender, plural);
  }
}

function best(form, list) {
  return list
    .map((c) => ({ ...c, exact: norm(c.lemma) === form ? 1 : 0, len: c.lemma.length }))
    .sort(
      (a, b) =>
        b.exact - a.exact ||
        a.len - b.len ||
        (a.pos === b.pos ? 0 : a.pos === "verb" ? -1 : 1) ||
        a.lemma.localeCompare(b.lemma),
    )[0];
}

const rows = [];
for (const [form, list] of cand) {
  const b = best(form, list);
  rows.push([form, b.lemma, b.pos, b.gender, b.plural].join("\t"));
}
const tsv = rows.sort().join("\n") + "\n";
const gz = gzipSync(Buffer.from(tsv, "utf8"), { level: 9 });
const outPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../assets/dict-forms.tsv.gz",
);
writeFileSync(outPath, gz);
console.log(`wrote ${outPath}: ${cand.size} forms, ${gz.length} bytes gzipped`);
