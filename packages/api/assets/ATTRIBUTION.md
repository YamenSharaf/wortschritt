# Bundled dictionary — data attribution

## `dict-forms.tsv.gz` — German inflection → lemma index

Generated (see `../scripts/build-forms-index.mjs`) from the RosaeNLG German
morphology dictionaries:

- **german-verbs-dict** and **german-words-dict** by Ludan Stoecklé / RosaeNLG,
  distributed under the Apache-2.0 license. The underlying morphological data is
  derived from Wiktionary and DWDS.

Only the mapping *inflected form → lemma (+ gender/plural)* is extracted; no
prose or definitions from those sources are redistributed.

## `dict-verb-forms.tsv.gz` — verb lemma → Partizip II

Generated (see `../scripts/build-verb-forms.mjs`) from **german-verbs-dict**
(same Apache-2.0 source as above). Only each verb's infinitive → past
participle (e.g. treffen → getroffen) is extracted.

## `dict-core-gloss.tsv` — curated core German→English glossary

Hand-authored for this project (see `../scripts/build-core-gloss.mjs`). Short,
original English glosses for high-frequency German words. Editable directly.
