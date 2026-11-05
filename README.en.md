<div align="center">

<img src="docs/assets/ariadne-mark.svg" width="96" height="96" alt="Ariadne's thread" />

# Ariadne

**Keep the thread of your work until the job is done.**

An integrated agent harness for goals, context, tools, and verified outcomes.

[![Verify](https://github.com/YouSangSon/Ariadne/actions/workflows/verify.yml/badge.svg)](https://github.com/YouSangSon/Ariadne/actions/workflows/verify.yml)
![Node.js 24.22+](https://img.shields.io/badge/Node.js-24.22%2B-43853d?logo=nodedotjs&logoColor=white)

[한국어](README.md) · [日本語](README.ja.md) · [English](README.en.md) · [简体中文](README.zh-CN.md)

[Product direction](docs/product-direction.md) · [Current features](#features) · [Getting started](#getting-started) · [Execution policy](docs/execution-policy.md)

</div>

The Korean README is the source of truth. Keep the structure, commands, and supported scope of all four languages in sync. Linked detailed documents are available in Korean or English. Translating the README does not mean that the CLI supports these display languages.

---

Ariadne is **an integrated agent harness that connects user goals to execution and verification**.

The goal is to connect the context, tools, and executors needed for a user's task and check the result.
The intended direction is to handle coding, research, document writing, analysis, and recurring work in the same workflow.

The project focuses on reducing repeated explanations of goals, repeated searches for the same information, and repeated calls without knowing why a previous attempt failed.
The measure is to reduce **total model usage needed to achieve the desired result** while retaining the necessary information and verification.
Ariadne does not yet provide an executor that automatically completes general-purpose work. Current features and implementation priorities are distinguished below and in the [product direction](docs/product-direction.md).

<a id="workflow"></a>

## Intended workflow

1. Understand the desired result and completion criteria. Do not ask again about what has already been confirmed.
2. Find relevant context and previous evidence, and pass on what the task needs.
3. Select tools and executors that match permissions, budget, and required capabilities.
4. Check the result and, if interrupted, resume from the verified state.

This workflow is a product goal. The project currently provides foundations for requirements, context, memory, and tool connections. Automatic assignment, execution, and resumption are under development.

<a id="features"></a>

## What you can use today

| Feature | Actual behavior |
| --- | --- |
| **REQ-based work** | Keep the goal, acceptance criteria, constraints, and verification commands in one requirements document |
| **Required context preservation** | Preserve confirmed facts and verification first, and fail without output if required information exceeds the budget |
| **Persistent memory** | PostgreSQL source of truth, Qdrant or pgvector search, organization-level permissions, and HTTP and MCP tools |
| **Code impact analysis** | Local SQLite graph, change impact, verification targets, evidence, MCP, and UI |
| **Ontology** | Read user-defined terms, relationships, and source files; perform bounded lexical search and check review status |
| **Knowledge relationships** | Promote work records to the wiki and index links and unresolved relationships |
| **Shared rules and skills** | Generate mirrors for Codex and Claude Code from one source and check that they match |
| **Change detection foundations** | Contract hash covering all acceptance criteria and immutable scope, and a source fingerprint including dirty, untracked, and mode changes |
| **Restricted file tools** | Check paths, symlinks, secrets, size, and the existing SHA, and replace files through temporary files |
| **API transport foundations** | Validate Chat Completions-compatible requests and tool responses, block redirects, and classify errors explicitly |

> **Under development:** The task database, dispatcher, automatic resumption, execution pool, and completion seal are not yet public execution features.
> This repository is a checkpoint that publishes verified context enrichment and connection foundations.
> The presence of an API transport module does not mean that general-purpose work can be completed automatically or that native CLIs can run unattended.

The installation and usage instructions below apply when you have the required permission. See [License](#license).

<a id="getting-started"></a>

## Getting started

Install and run the full product with **Node.js 24.22.2 or later**. The file-based core works without an external database. The persistent memory service requires PostgreSQL and a selected vector store. The example below installs everything; to use only selected modules, clone first and follow [module selection](#module-selection).

```sh
git clone https://github.com/YouSangSon/Ariadne.git
cd Ariadne
npm run setup
npm run verify
node bin/Ariadne.mjs --help
```

<a id="module-selection"></a>

### Selecting modules

The source checkout always contains all modules. Pass comma-separated names from the table to `setup` or `verify` with `--modules`; `core` is always included. Omit the option to install or verify all modules.

| Module | Role and requirements |
| --- | --- |
| `core` | Shared harness; no external database or npm package dependencies |
| `ontology` | Search and review JSON terms, relationships, and sources; no external database or npm package dependencies |
| `memory` | Persistent memory; requires PostgreSQL and a configured vector store |
| `code` | Code impact analysis; uses local SQLite in the target repository |

```sh
# Select only core or ontology
npm run setup -- --modules core
npm run setup -- --modules ontology
# Install and verify memory and ontology together
npm run setup -- --modules memory,ontology
npm run verify -- --modules memory,ontology
```

Only selected package dependencies are installed. Selection is not saved, so pass the option again on subsequent runs. It does not uninstall existing dependencies or hide other modules' commands.

Ontology uses user-authored JSON terms, synonyms, typed relationships, and source paths.

```sh
node bin/Ariadne.mjs ontology inspect --file modules/ontology/example.json
node bin/Ariadne.mjs ontology search --file modules/ontology/example.json --query memory --limit 5
```

Each read recomputes a review digest from definitions and source files and reports `unreviewed`, `current`, or `stale`. Search is bounded lexical search; it provides no LLM, SQL, or answerability judgment. Review status is not authenticated approval. The existing `knowledge promote` and `knowledge index` commands handle separate wiki snapshots.

Memory, code, requirements, context packs, rules integration, wiki, execution foundations, and ontology own their rules and data. Their domains and applications depend on ports; file, database, HTTP, and process adapters connect from the outside. Existing entrypoints and storage contracts remain compatible. See [architecture](docs/architecture.md) for ownership and boundary checks, and [modules and ontology](docs/modular-ontology.md) for the ontology format.

Run the available code analysis and context commands from the repository where you are working. Code commands require the `code` module's dependencies.

```sh
node /path/to/Ariadne/bin/Ariadne.mjs code init
node /path/to/Ariadne/bin/Ariadne.mjs code index
node /path/to/Ariadne/bin/Ariadne.mjs code analyze --changed src/example.ts --fail-on none
node /path/to/Ariadne/bin/Ariadne.mjs context --root . --req my-task
```

To use memory, install the `memory` module's dependencies, copy `packages/memory/.env.example` to `.env` at the root, and check the database and vector settings. Exclude actual values from Git. The default transformer model runs locally and may download weights on its first run. API keys and paid providers are not configured automatically.

```sh
node --env-file=.env bin/Ariadne.mjs memory serve
node --env-file=.env bin/Ariadne.mjs memory mcp
```

For client connections and repository configuration, follow the [configuration and operations guide](docs/consolidation.md#runtime-directories-and-agent-clients).

Copy shared rules and skills to an independent installation path.

```sh
node scripts/install.mjs
```

Existing global configuration is linked only when you select `--global-pointer`.
For project application and removal, follow [onboarding](docs/ONBOARDING.md) and the [operations guide](docs/OPERATIONS.md).

<a id="responsibilities"></a>

## Responsibilities of rules and executors

| Target | Ariadne's role | Maintained separately |
| --- | --- | --- |
| **Codex · Claude Code** | Provide shared work rules, requirements, and context | Each tool's login, session, and execution permissions |
| **Gemini** | Optional manual handoff packet foundations | The user's CLI installation, authentication, and execution |
| **Model APIs · Grok and others** | Compatible HTTP transport and restricted tool format | Separate API authentication, charges, and verification of actual provider compatibility |

You can use just one tool. Connecting multiple tools does not combine their authentication or subscriptions.
Paid provider calls, native automatic execution, and OS-level process isolation have not been verified.

<a id="principles"></a>

## A small harness with verifiable rules

- Preserve required context first so that long optional notes do not displace the verification contract.
- Explicitly reject invalid REQ IDs, statuses, duplicate acceptance criteria, and unsupported syntax.
- Include paths, types, modes, and untracked changes in the source fingerprint as well as file contents.
- Keep checks and guards that address real failures. The number of rules or agents is not a goal.
- Distinguish a model's completion claim, local checks, remote CI, and production results.

`AGENTS.md` communicates working rules. Scripts and tests cover what can be checked deterministically.
An instruction file alone does not provide background event handling or automatic recovery.

<a id="verification"></a>

## Verification

```sh
npm run verify
# To check core source without package dependencies
node scripts/verify.mjs
```

The full `npm run verify` retains the existing package checks. Pass `--modules` to verify a selection, as with setup. Core source checks include shared ontology source tests even when only `core` is selected.

The checks use real files, temporary projects, and HTTP servers started by the tests. CI runs PostgreSQL, pgvector, and local transformer search verification as separate jobs. Model calls are not required.
Do not treat API protocol checks as evidence of model quality, subscription savings, or production performance.
An arbitrary external writer racing between the file SHA check and rename is not covered, so an independent workspace is required.

<a id="repository-guide"></a>

<details>
<summary><strong>Repository guide</strong></summary>

| Location | Role |
| --- | --- |
| `core/AGENTS.core.md` | Source of short shared rules |
| `skills/` | Sources for requirements, routing, context, and handoff skills |
| `.agents/`, `.claude/` | Generated mirrors for each tool |
| `lib/`, `scripts/`, `tests/` | Deterministic checks and regression evidence |
| `packages/memory/`, `packages/code/` | Internal implementations, pinned dependencies, existing contracts, and tests |
| `bin/Ariadne.mjs` | Single installation and execution entry point |
| `modules/ontology/` | File-based ontology model and search |
| `modules/llm-wiki/` | Wiki promotion and relationship index |
| `modules/loop/` | Foundations for contracts, file tools, transport, and manual handoffs |
| `evaluation/` | Control group for evaluation tooling without model calls |

The project name and repository path are **Ariadne / `Ariadne`**.
Existing installation data formats and identifiers, including `.harness/`, `~/.harness`, and `harness-*`, are preserved.

</details>

<a id="license"></a>

## License

The source is public for inspection. Use, copying, modification, and redistribution require prior written permission from the copyright holder. Rights under applicable law, platform terms, earlier licenses, and third-party licenses remain unchanged. See [LICENSE](LICENSE).

---

**Read the intent. Keep the thread. Verify the result.**
