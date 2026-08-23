// Regenerates packages/api/assets/dict-verb-forms.tsv.gz — verb lemma → Partizip II.
// Source: german-verbs-dict (Apache-2.0, Wiktionary/DWDS-derived). Not a project
// dependency; install ad hoc to regenerate:
//   npm i german-verbs-dict
//   node packages/api/scripts/build-verb-forms.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
const require = createRequire(import.meta.url);
const verbs = require("german-verbs-dict/dist/verbs.json");
const rows = [];
for (const [inf, d] of Object.entries(verbs)) {
  const pa2 = Array.isArray(d.PA2) ? d.PA2[0] : d.PA2;
  if (!pa2 || String(pa2).includes(" ")) continue;
  rows.push([inf.toLowerCase(), pa2].join("\t"));
}
const tsv = rows.sort().join("\n") + "\n";
const gz = gzipSync(Buffer.from(tsv, "utf8"), { level: 9 });
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/dict-verb-forms.tsv.gz");
try { writeFileSync(out, gz); } catch { writeFileSync("dict-verb-forms.tsv.gz", gz); }
console.log("verbs:", rows.length, "| gz bytes:", gz.length);
