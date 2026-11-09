# Report projector v1

The manifest, input and output JSON Schemas and `report-projector.wit` define the
first, hostcall-free projection contract. `fixtures/cases.json` is the single
fixture inventory used by Go and schema conformance checks. Fixtures contain
literal bytes, including deliberately invalid UTF-8 and duplicate JSON keys.

The input is a host-selected comparison summary, not raw comparator input. Its
source ID is opaque and its digest identifies the original selected report.
`comparable` means the existing comparator found matching comparison identities;
all outcomes remain reported, descriptive and unauthenticated. Ineligible
comparisons use `descriptive-only`. Unknown totals use `{ "status": "unknown" }`;
known totals require a nonnegative value. Token counts are exact integers up to
9,007,199,254,740,991; costs use finite floating-point values. Nonzero costs
that underflow to floating-point zero are rejected. Missing information never becomes zero.
No parsing, projection or artifact digest authenticates a verifier receipt.

Output contains only sections, text, optional tables and the input source ID.
Source references must match the selected input, tables must be rectangular, and
all tables together may contain at most 1,024 cells, including column headers.
No output field grants approval, rewrites the original, or changes verification.
Render text as inert content for the destination; never interpret it as a command.
The E0 built-in projector emits fixed plain text and numeric cells only.

JSON must be UTF-8 with paired Unicode surrogate escapes, without duplicate keys,
unknown fields, explicit null, extra JSON values, aliases of field names or wrong
types. All declared properties are required unless explicitly optional. Empty
capabilities are required. Extension IDs use lowercase `namespace/name` identifiers;
v1 versions are three decimal components (without prerelease/build suffixes).
License is a single identifier, not an expression or executable path.

Standard JSON Schema describes structural/type constraints. Implementations must
also enforce these documented `x-*` constraints and strict byte parsing:

- `x-maxBytes`: maximum complete UTF-8 JSON byte count, including whitespace.
- `x-maxUtf8Bytes`: maximum decoded string UTF-8 byte count (8 KiB).
- `x-rectangularRows`: each row width equals the column count.
- `x-maxTableCells`: aggregate header and row cells across all sections (1,024).
- `x-inputSourceIds`: references equal the selected input's sole source ID.

Manifest maximum is 32 KiB, input 1 MiB, output 256 KiB, sections 32. Typed output is also checked after host JSON
serialization. Text permits
newline, tab and carriage return, while rejecting other C0 controls and DEL.
UTF-8 byte limits differ from JSON Schema's Unicode character `maxLength`.
Malformed-byte, relational and byte-limit fixtures may pass a generic schema
validator; the combined contract validator must reject them. The fixture runner
must reject syntax/duplicate/UTF-8 errors before ordinary JSON decoding.

These contracts supply no package installation, registry, activation, untrusted
execution, WIT compiler/binding qualification, or sandbox. Separate experimental
E0 package inspection checks actual raw artifact bytes and their SHA-256; parsing
a manifest alone does not verify its artifact or actual WASM imports/exports.
The built-in registration descriptor declares the same projection world and
schema contract with runtime `builtin`. It has no WASM artifact hash. Binary
release identity belongs to host composition/release metadata. User manifests
require an artifact SHA-256, which remains a claim until the package reader
verifies the actual raw WASM bytes. A matching hash is no safety proof.
