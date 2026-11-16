# Unicode17 ontology compatibility data

The G1a Go library preserves the existing Node24.22.2 / ICU78.3 / Unicode17
ontology behavior. It does not enable a Go ontology CLI or replace Node.

`unicode-data.json` records the official Unicode17 URLs, SHA-256 and byte sizes
of NormalizationTest, SpecialCasing and DerivedCoreProperties. The original data
and Unicode license are retained here. `license-provenance.json` also records
the upstream x/text v0.44.0 BSD license. The dependency checksum is pinned in
`runtime/go/go.sum`; no upstream implementation code is copied.

`node scripts/generate-ontology-unicode.mjs --check` verifies the compact Cased
and Case_Ignorable range tables. Without `--check`, it regenerates the table
from the fixed DCP bytes. Run gofmt on the generated file afterward.

`node scripts/ontology-scrub-goldens.mjs` checks 27 numeric UTF-16 fixtures
against the unchanged Node scrub owner, including all 13 categories, ECMAScript
whitespace, ASCII word boundaries, replacement order and unpaired units.
`--write` is only for reviewed fixture updates. All inputs are synthetic.

`node scripts/ontology-unicode-oracle.mjs` reproduces the scalar hashes and
normalization conformance against the frozen Node runtime.

Go tests assert the original public data/license hashes, 100,170 normalization
checks across 20,034 official rows, Unicode table versions and exhaustive
1,112,064-scalar lowercase/property hashes observed with the Node oracle.
Selected whole-context, surrogate-barrier, concurrent normalization and scrub
checks supplement those scalar hashes. These tests do not prove equivalence for
every possible string or filesystem behavior. The existing 36 ontology goldens
separately cover typed validation, application ordering, search and digest bytes.
