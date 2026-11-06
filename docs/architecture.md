# Ariadne architecture

Ariadne keeps data ownership inside bounded contexts. Domain rules and application
use cases depend on models, policies, and ports. Filesystem, database, model,
process, and network adapters implement those ports. Composition connects the
adapters to public CLI, HTTP, MCP, hook, and operator entrypoints.

The [whole-project design](full-refactor-design.ko.md) separates this structural
refactor from future task execution and distributed deployment. Named multi-resource
bindings, Kafka/RabbitMQ adapters, and MSA deployment are target contracts, not
features enabled by moving the existing implementation into layers.

## Context owners

| Context | Domain and application | External adapters and composition |
| --- | --- | --- |
| Requirements | `modules/requirements/domain.mjs` parses strict execution contracts and selects source inputs. `application.mjs` hashes contract payloads and coordinates source inspection through ports. | `files.mjs` bounds local reads and inspects Git. `modules/loop/contract.mjs` retains the existing public exports. |
| Context packs | `modules/context/domain.mjs` renders mandatory fields and budgets optional notes. `application.mjs` selects active requirements through record-read ports. | `files.mjs` supplies scrubbed harness records. `lib/context-pack.mjs` retains the builder and CLI contracts. |
| Rules integration | `modules/integration/domain.mjs` owns markers, mirror content, file caps, and install or adaptation plans. `application.mjs` applies those plans through file capabilities. | `files.mjs` reads, writes, backs up, and restores owned files. Existing scripts remain the command entrypoints. |
| Wiki | `modules/llm-wiki/domain.mjs` renders snapshots and resolves graph links. `application.mjs` coordinates idempotent promotion and full graph replacement. | `files.mjs` reads the vault and writes derived pages. `promote.mjs` and `graph-index.mjs` remain the entrypoints. |
| Execution foundations | `modules/loop/domain.mjs` owns `AdapterError`. `native.mjs` produces manual handoff packets. | `adapters/api-wire.mjs` validates completion wire data. `adapters/api.mjs` sends bounded HTTP requests. Existing `api.mjs` and `files.mjs` preserve exports. |
| Ontology | `modules/ontology/domain.mjs` validates vocabulary and review state. `application.mjs` coordinates document, source, and hash ports. | `files.mjs` implements bounded local reads. `cli.mjs` composes the read-only commands. |
| Product core | `core/domain/product.mjs` selects command targets, lifecycle steps, and verification environment rules. `core/application/` runs lifecycle and source verification through process and reporting ports. | `bin/`, `scripts/product.mjs`, and `scripts/verify.mjs` retain argument, exit, signal, and working-directory behavior. `lib/command.mjs` owns child-process lifecycle. |
| Evaluation controls | `evaluation/domain.mjs` validates the control suite. `application.mjs` distinguishes expected baseline failures from passing reference results through execution ports. | `evaluation/files.mjs` materializes isolated fixtures, probes them in child processes, and cleans them. `scripts/verify-evaluation.mjs` remains the verifier entrypoint. |
| Memory | `packages/memory/src/domain/` owns memory, compaction, vector, and evaluation policies. `src/application/` owns use cases, service contracts, and repository capabilities. | `src/infrastructure/` owns PostgreSQL, vector backends, files, embeddings, and operator processes. `src/interfaces/` and `src/composition/runtime/` expose and assemble existing commands and services. |
| Code | `packages/code/src/domain/` owns code, impact, contract, graph, and local-fact policies. `src/application/` coordinates storage, graph, workspace, and model capabilities. | `src/infrastructure/` owns SQLite, repository files, Git, models, and language adapters. `src/interfaces/` and `src/composition/` expose and assemble existing commands and services. |

The package details belong to [memory architecture](../packages/memory/docs/architecture.md)
and each package's ownership map. Ontology formats and review behavior belong to
[modules and ontology](modular-ontology.md). Module selection controls setup and
verification dependencies. It does not move, migrate, or delete stored data.

## Shared code and compatibility

The shared pure exports are `lib/scrub.mjs`, `lib/budget.mjs`, `lib/caps.mjs`,
`lib/module-selection.mjs`, and `core/domain/requirement-fields.mjs`. The last file
owns the limited two-space REQ field parser. Context packs accept partial REQs.
The strict execution parser separately requires canonical, nonempty acceptance
criteria. Contract hashes still combine canonical criteria with raw selected
scope blocks. Source hashes still cover path, kind, mode, and file content while
excluding the selected REQ and handoff records. Git HEAD is provenance only.

`core/domain/project-files.mjs` owns protected-path and content rules.
`core/infrastructure/project-files.mjs` owns filesystem checks, bounded reads,
hashes, and guarded writes. `lib/project-files.mjs` remains an outward façade.
Ontology consumes raw text inside its file adapter. Loop file tools expose only
the original scrubbed read, list, and guarded write functions. The check before
rename still requires an exclusive workspace against arbitrary external writers.

The shared guarded filesystem adapter, hook I/O, and existing mirror-library
entrypoint are explicit outward cross-context exceptions. Other contexts cannot
import arbitrary internals. Domain and application code cannot import legacy
compatibility façades. Package historical module paths remain outward façades,
and existing SQL assets and migration paths remain in place.

Memory writes retain one reserved PostgreSQL session across locks, repository
operations, and pgvector writes. Application code receives an indivisible write
scope rather than a SQL client. Code publication retains synchronous SQLite
transactions and savepoints for related graph, fact, head, and vector writes.
External model calls stay outside those transactions. These boundaries preserve
storage contracts rather than introducing a new schema or data migration.

## Installation content

`scripts/install.mjs` retains the existing prefix, manifest format, marker blocks,
global-pointer opt-in, and backup restoration. It installs `core`, `skills`, and
`templates`, plus the context command's runtime closure under `lib` and
`modules/context`. The shared REQ parser is included under `core/domain`.
`manifest.json` records every owned file, so uninstall removes those files and
preserves unrelated files. A supplied core-only source tree without the context
entrypoint remains a core-only installation.

## Ownership and boundary checks

[`architecture-map.json`](../architecture-map.json) classifies root runtime,
tooling, and validation sources. The
[memory map](../packages/memory/architecture-map.json) and
[code map](../packages/code/architecture-map.json) classify package production
sources and tools. Each record names a context and layer. Compatibility records
also identify their canonical target when the façade has a single owner.

The root check discovers JavaScript, TypeScript, shell, and SQL sources throughout
the checkout, including new top-level tooling. This covers `bin`, `core`,
`evaluation`, `hooks`, `lib`, `modules`, `scripts`, and `tests`. It also records the root package manifest, CI workflows,
sample hook settings, security configuration, REQ template, and bundled JSON
fixtures. Private `.harness` evidence and `.ariadne` preservation data are
excluded. Package production coverage scans `src`, `scripts`, and `bench` when
present. Shell and SQL files receive ownership records. Package
tests, dependency trees, and generated build directories are outside production
coverage. Root checks read package source and maps without loading their npm
dependencies. Package AST checks run with the selected package's canonical gate.

The dependency-free root scanner lexes literal JavaScript and TypeScript imports,
re-exports, dynamic imports, and CommonJS loads. It skips comments and string
examples, rejects unreviewed computed loads and unsupported aliases, and checks
declared external packages. CommonJS supports bare literal `require` calls and
the canonical `const require = createRequire(import.meta.url)` binding. Loader
aliases, property access, and optional-call forms fail the check. It is not an AST parser or runtime sandbox. The launcher, isolated
evaluation probe, dedicated MCP test, and profiling benchmark have explicit
computed-import expressions. New loader syntax requires a rejecting control or a
package AST rule. Package inward code permits deterministic `node:path`,
`node:crypto`, and `node:util` helpers where its local rules allow them.

Run the source boundary controls with `node --test tests/module-boundaries.test.mjs`.
Run core sources with `node scripts/verify.mjs`. Run the selected product gates
with `npm run verify -- --modules memory,code,ontology`, or omit selection for the
full product. Local source tests, database integration tests, CI, deployment, and
real model quality remain separate evidence. The paused dispatcher and automatic
recovery runtime remain unimplemented.

## Selected context and recorded evaluation

Context owns the local skill metadata subset and explicit `slug@sha256` selection.
Its adapter reuses the guarded project reader; selected full bodies enter the
existing mandatory context budget. Catalogs and bodies are untrusted references,
not permission grants. The rule installer includes the complete reader closure.

Evaluation owns `comparison.mjs` and the read-only `compare-cli.mjs` adapter.
It pairs reported runs by case/variant and rejects inconsistent input, while
missing comparison conditions remain descriptive-only. Retry spend is included;
missing usage remains null. These reports do not authenticate verifier receipts
or activate the paused dispatcher. See [adoption contracts](harness-engineering-adoption.md).
