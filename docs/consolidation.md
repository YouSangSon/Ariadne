# One Ariadne project

Current context ownership, inward dependencies, and compatibility paths belong
to the [architecture reference](architecture.md).

Ariadne combines requirements, bounded context, durable memory, code impact,
file-based ontology and wiki relationships in one checkout. Install with `npm run setup`, verify with
`npm run verify`, and use `node bin/Ariadne.mjs` from any target repository.
No sibling checkout, global package installation or model subscription is required
for the local harness and code graph.

| Former project | Current owner | Entry point |
| --- | --- | --- |
| Akasha | `packages/memory` | `Ariadne memory …` |
| Context-forge | Already renamed into Akasha; context-pack implementation is in memory and core | `Ariadne context …`, `Ariadne memory pack …` |
| Parallax | `packages/code` | `Ariadne code …` |
| Ontology design | Original enterprise design retained privately; new file-based module in `modules/ontology`, plus a separate wiki relationship index in `modules/llm-wiki` | `Ariadne ontology inspect …`, `Ariadne ontology search …`, `Ariadne knowledge index …` |

The former ontology was a design collection, not an implemented enterprise
service. The new module reads user-authored JSON terms, synonyms, typed
relationships and source paths. Each read recomputes a review digest from the
definitions and source files and reports `unreviewed`, `current` or `stale`.
It provides bounded lexical search, not an LLM, SQL, an answerability judgment
or authenticated approval. Separately, the wiki index is a snapshot that resolves
relationships and reports unresolved links when regenerated. Neither implements
an enterprise ontology server or graph database. Original raw enterprise
documents and unfinished source changes are not public imports.

## Installation and configuration

```sh
npm run setup
node bin/Ariadne.mjs --help
npm run verify
```

Omitting `--modules` selects every module. Pass comma-separated names from `core`,
`ontology`, `memory` and `code` to install or verify a selection; `core` is always
included. The source checkout still contains all modules. For example:

```sh
npm run setup -- --modules core
npm run setup -- --modules ontology
npm run setup -- --modules memory,ontology
npm run verify -- --modules memory,ontology
node bin/Ariadne.mjs ontology inspect --file modules/ontology/example.json
node bin/Ariadne.mjs ontology search --file modules/ontology/example.json --query memory --limit 5
```

Core and ontology use source files without external databases or npm package
dependencies. Memory needs its existing PostgreSQL and vector configuration;
code uses local SQLite. Setup installs only the selected packages' dependencies
and builds them in their own cwd. A selection is not persisted, does not remove
previously installed dependencies and does not hide commands. Pass it again on
each setup or verification run.

Two internal lockfiles preserve tested dependency versions and isolate the two
TypeScript/test toolchains. A workspace-wide dependency rewrite was rejected
because it would change dependency resolution and packaging guarantees during a
source relocation. There are no independent package releases (`private: true`).

Memory, code, ontology, and the root capability contexts own their models and
storage. Their domain rules and application use cases depend inward on policies
and ports. Concrete storage, transport, model, and process adapters connect at
composition boundaries. Historical entrypoints preserve their existing exports.
See the [architecture reference](architecture.md) for the complete ownership and
validation scope, and [modules and ontology](modular-ontology.md) for the ontology
file format.

Copy `packages/memory/.env.example` to root `.env` if using the memory service.
Review the [memory configuration](../packages/memory/docs/configuration.md), then
pass that file explicitly using Node:

```sh
node --env-file=.env bin/Ariadne.mjs memory serve
```

`DATABASE_URL`, vector backend, organization authorization and embedding identity
remain the memory package's contracts. The default transformer model runs locally
and can download weights on first use. The `local` embedding provider is a
deterministic test provider without semantic retrieval quality. The `openai`
provider is an explicit paid option; setup does not select it or create API keys.

Code commands use the target repository's `.parallax` data and configuration.
Existing protocol names, schemas, environment variables and data directories keep
their identities to avoid silently disconnecting data. They are not separate
projects that the user must install.

## Runtime directories and agent clients

Runtime commands retain the target repository cwd. Installation/build/audit and
backup shell scripts use their internal package cwd. Memory `init` binds the
generated wrappers to Ariadne's installed runtime and root `.env`, while retaining
the target workspace for relative source reads. Credentials are read at runtime;
their values are not embedded in generated client configuration.

```sh
node /path/to/Ariadne/bin/Ariadne.mjs code install-agent --dry-run
node /path/to/Ariadne/bin/Ariadne.mjs memory init --project my-project --organization-id personal
```

`code install-agent` and `code install-hook` use an internal executable adapter
because the existing hook contract accepts one executable, not a shell command
string. Both run the same Ariadne entry point with `code` as an argv element.
Explicit `--command` and `--name` still override those generated defaults.

MCP clients can register two entries pointing at the same Ariadne installation:
`node /path/to/Ariadne/bin/Ariadne.mjs code mcp serve` and
`node --env-file=/path/to/Ariadne/.env /path/to/Ariadne/bin/Ariadne.mjs memory mcp`.
Keep the code MCP cwd at the target repository. Existing tool names and
authorization remain intact. Installation never edits global agent credentials.

## Preservation and recovery

Committed imports start at memory `0bcf16f79d1917bd75cf370660a2ce6a9e444b35`
and code `582d400b4a65b28a3512e643d2c99d314fb24e5a`. The code branch also contained an intentionally failing, unmerged FTS row-reuse
requirement. That prototype is preserved privately; the active import uses the
last merged main baseline with identical runtime source. The later security fixes cover parser termination and
file/configuration races found by the integrated checks. Storage schemas remain
unchanged. Current first-party terms are in `LICENSE` and both internal package notices.
Previously granted rights and third-party licenses remain unchanged. Original Git ancestors are not joined to Ariadne's public
history. Verified private archives preserve all refs, working files, ignored data
and unfinished changes, including the extra memory evaluation worktree.

The private archive's receipt records file SHA-256, mode, symlink targets, source
HEAD/refs/status and archive/bundle hashes. It is ignored local recovery material,
not content to attach to an issue or PR. Verify these hashes and `git bundle verify`
before restoring. Restore into an empty private directory, never over user work.
Linked worktrees and absolute symlinks need their recorded Git common directory
restored or repaired. Raw source tarballs retain their original Git metadata;
bundles independently preserve complete reachable history.

`.parallax/impact.db` contains facts, transactions and branches as well as indexes.
The preserved historical SQLite snapshot includes WAL recovery and a consistent
canonical backup. Absolute `repos.root` identities are retained; copying this
history into a new cwd does not migrate its identities or source path semantics.
Do not silently overwrite an active Ariadne DB with it.

PostgreSQL, Qdrant and backup volumes are outside source folders. Existing volumes
are preserved, not deleted or declared migrated by a source tarball. Before using
the moved Compose files, identify the existing Compose project, volumes, database
and collection, then pass the **confirmed** project name explicitly with `-p`.
Do not accept a healthy empty database as evidence of data transfer. This
consolidation neither starts an unknown deployment nor changes its credentials.

## Verification and learning

The full root gate runs core and ontology source tests, mirror/REQ checks, memory
typecheck/tests/audit and the code package's full canonical gate. The source-only
`node scripts/verify.mjs` needs no package dependencies and includes the shared
ontology source tests; selecting `core` also runs those tests. Memory PostgreSQL/pgvector and transformer
retrieval jobs remain separate root CI jobs; local non-PG tests do not establish
those outcomes. Root tests exercise the CLI from a different repository, including
affected-file output and the original nonzero impact-gate exit status.

The important boundary is product ownership versus persistence ownership: one
install can retain PostgreSQL canonical memory and SQLite code/fact storage.
Keeping those responsibilities avoids a speculative storage migration. To test
the boundary yourself, run the same root CLI from a second temporary repository:
code indexes must remain isolated, while memory sharing requires the same
explicit project and organization scope.

Unfinished Parallax FTS work and Ariadne's dispatcher runtime stay preserved
unqualified work. Source consolidation does not complete or activate them.

A macOS fixture correction uses the existing canonical-root helper for direct
SQLite repo lookups, matching production indexing (`/var` may resolve to
`/private/var`). This changes test paths, not the persisted identity contract.

## File and configuration concurrency

Source previews open the approved file without following a replaced leaf symlink,
compare its descriptor identity, and bound reads to one megabyte. Replaced
ancestors and file growth are rejected in the tested interleavings. This portable
Node implementation is not a filesystem sandbox against a malicious process
changing ancestor directories during every validation step. Keep the local UI
on a trusted workspace; stronger namespace isolation requires OS support.

Project initialization uses exclusive config creation. MCP installers serialize
on the canonical target, preserve ordinary symlinks and permission bits, and
reject detected edits before an atomic replacement. A dangling symlink fails
closed. Other writers must follow the same lock protocol for exclusion; a writer
that ignores it can race the final check. Atomic replacement changes the inode
and does not preserve hardlink aliases or platform ACL metadata.

The root secret scan uses the default Gitleaks rules. Rule-specific exceptions
in `.gitleaks.toml` require both the exact file path and the exact reviewed
synthetic test or local example secret. They remain valid after history rewrites.
Different values in those files and matching values elsewhere remain subject to
the scanner.
