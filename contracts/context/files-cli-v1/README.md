# Context files and experimental CLI contracts

This is the G1c3 read-only adapter contract. The Node product remains the default.
`scripts/context-files-node-goldens.mjs --check` observes the actual local Node
24.22.2 / ICU 78.3 / Unicode 17.0 sources, fixture inputs and oracle hashes. Only
`--write` regenerates expected results. UTF-16 hex preserves isolated surrogates;
all byte contents, sizes, file kinds and symlink targets belong to `cases.json`.
The separate [pure corpus](../node-v1/README.md) retains all 272 C2 cases.

## Record and project-file boundaries

Harness records retain Node's exists-probe followed by a normal following read.
An absent or dangling path gives blank text; a successful probe followed by a
read failure propagates the failure. Bytes decode with Node-style maximal UTF-8
subpart replacement, preserving BOM and NUL, then use Core scrubbing. There is no
new size cap, regular-file requirement or deadline. FIFOs can block until a
writer or external signal arrives. REQ listing takes every `.yaml` name, decodes
native names before use and sorts full filenames by UTF-16 before stripping
`.yaml`; file kinds are not prefiltered.

Skill bodies use the public Core `ProjectTextReader`: path policy, canonical
root, nofollow/nonblock descriptor walk, regular file, 1 MiB, strict UTF-8 and NUL
checks. Context first detects secrets in the identifier, then reads through Core,
then checks 64 KiB of original bytes, parses metadata, and scrubs description and
whole content separately. SHA-256 identifies original bytes. `chars` counts
scrubbed UTF-16 units. Catalog output contains no body.

The private fixed `skills` directory listing rejects a symlink or nondirectory
root and pins one local directory descriptor with before/open/current identity.
It reads at most 101 entries: the 100-entry cap precedes any entry-symlink error,
then only directory names are selected and UTF-16 sorted. All entries count
towards the cap. No protected-name or slug prefilter runs here. Application skill
selection separately caps at 20. Darwin and Linux are implemented; other OSes
explicitly fail closed and have no qualification claim.

## CLI

`runtime/go/cmd/Ariadne` dispatches `context` and `skills` before extension SQLite
or provider work. `context` accepts separate values for `--root`, `--req`,
`--budget`, and repeated `--skill`; it checks option, value and duplication in
that order. There is no context-local help, equals syntax or acceptance option.
Unknown budgets keep Node's standard budget. Default cwd is read only if root is
absent after valid syntax. Output is replacement UTF-8 with no extra newline.
Errors use Core scrub, the `context-pack:` prefix and exit 1.

`skills` accepts zero arguments or exactly `--root VALUE`. It emits Node's fixed
schema/trust/row order as two-space JSON plus newline. Lone surrogates are escaped;
HTML, U+2028/U+2029 and empty arrays keep JSON.stringify behavior. There is no
whole-value scrub replacer. Errors use `skills:` and exit 2. Unix argv decodes
before option checks and path use; existing ontology CLI has the same private
argv boundary. Relative Core roots and ontology manifests resolve from a physical
syscall cwd, decoded before lexical path construction. Absolute paths do not read
cwd. Core and Requirements share Node-compatible root resolution. On first visiting a
link, the resolver checks the raw target before decoding and resolving its text.
Core pins the final physical OS path for its nofollow descriptor walk. Strict file UTF-8 is
unchanged. Metadata with explicit `--root .` keeps relative path behavior.

## Native proof and limitations

`tools/qualify_context_files.py` requires pinned Node and Python 3.14.5 plus a
prebuilt non-race Go executable. It pairs actual stdout/stderr/exit from another
cwd, records raw argv hex, exercises replacement-name roots and native Linux
cwd/symlink cases, and runs >1 MiB FIFO writers in waited child processes. Blocked
SIGINT, SIGTERM and forced SIGKILL observations include raw return code, shell
status, Wait and process-group absence; no product-wide signal handler is added.
Native errno message bytes are recorded separately from portable equality.

The qualifier owns every profile, Git, paired CLI, reader and writer child from
startup through wait and group-absence observation. It defers raising an interrupt
until Popen returns and the handle is registered; it does not change inherited
signal masks or install a product handler. Its regression script covers original
mask preservation, actual startup handshakes and interruption during cleanup.
Each fresh report has a unique run and scratch identity, source and binary hashes,
and separate behavior/cleanup outcomes. A caller must preserve its outer paths if
the matching report is missing or cleanup is incomplete after native work starts.
CI and the local continuation use the same receipt predicate and a fresh run marker
that binds source, binary and scratch identities. Regression-driver timeouts still
run bounded supervisor Wait and authoritative nested-ledger cleanup; uncertain
cleanup preserves the fixture and blocks outer recursive deletion.

The Go Linux-only reader tests use actual pinned Node on native temporary storage
for malformed filenames, canonical symlink roots and cwd resolution. macOS/APFS
rejects malformed native filenames with EILSEQ during setup; that is not a behavior
RED. Local Linux CGO-disabled reader proof is distinct from the pinned CGO-enabled
native CI job and its actual executable qualification. CI, publication and default
runtime adoption require their own observed results.

These adapters retain a stable-workspace assumption and do not provide an OS
sandbox or an atomic multi-file snapshot. Permission and OS-error text, arbitrary
hostile writers and non-Unix runtime support are outside a byte-parity claim.
An ordinary raw symlink cycle fails with the OS ELOOP error. A decoded-only cycle
can block like Node; Linux probes and Go regressions run it only in externally
killed and waited child groups. No arbitrary production cycle cap is introduced.
