> **English** | [한국어](architecture.ko.md)

# Architecture

This document explains how Akasha is structured and how data flows
through it. For per-tool API details see [api-reference.md](api-reference.md);
for env-var setup see [configuration.md](configuration.md).

## Layers

The memory package is one bounded context. Memory, goal runs, entity mentions,
retrieval, and compaction share its model and authorization rules. Folders within
this context describe responsibilities, rather than independent services.

| Owner | Responsibility |
| --- | --- |
| `src/domain/model/` | Memory, source, goal-run, compaction, and vector values. |
| `src/domain/policies/`, `src/domain/evaluation/` | Secret rejection, scope validation, chunking, ranking, duplicate detection, decay, context selection, and deterministic evaluation metrics. |
| `src/application/contracts/`, `src/application/ports/` | Transport-independent commands/results and typed capabilities for repositories, embeddings, vectors, writes, logging, identity, and project sources. |
| `src/application/tools/`, `src/application/usecases/`, `src/application/indexing/` | Tool behavior, retrieval, canonical indexing, compaction, restore, and retry workflows. |
| `src/application/lifecycle/`, `src/application/ingest/`, `src/application/evaluation/`, `src/application/operations/` | Lifecycle file planning, synchronous source ingestion, evaluation parsing/grading/receipt checks, and backup/restore validation. |
| `src/infrastructure/` | PostgreSQL SQL and session ownership, vector and embedding adapters, files, process execution, configuration, identity lookup, health probes, and logging destinations. |
| `src/interfaces/` | HTTP and MCP transport contracts, authentication, schemas, CLI/operator commands, and worker timers. |
| `src/composition/runtime/` | Provider selection, canonical-service bootstrap, and default bindings for registries, workers, ingestion, and lifecycle writes. |

Domain code imports only domain code. Application code imports only domain and
application code. Infrastructure implements the inward ports. Transport adapters
and composition roots connect those parts. Inner code never imports a historical
facade, MCP/HTTP SDK, filesystem/process adapter, environment configuration, or a
PostgreSQL pool/query interface. Pure path, hash, and comparison operations use
`node:path`, `node:crypto`, and `node:util` in application code.

`MemoryWriteCoordinator` exposes record, archive, create, and restore operations.
Its PostgreSQL implementation reserves one session and creates all scoped
repositories and the pgvector adapter from that same session. Advisory locks,
transaction callbacks, indexing intent, compensation, and vector cleanup remain
inside that capability. Passing a general SQL executor into a use case would
break this guarantee. Application workflows instead consume typed repositories
and the indivisible write scope.

Service commands and results live in `application/contracts/tools.ts`. MCP-only
roots, elicitation, sampling, and authorization DTOs live in
`interfaces/mcp/contracts.ts`. HTTP and MCP continue to share service schemas and
the same registry, including organization checks and error behavior.

Evaluation corpus assembly, preflight seeding, profile and paid-execution guards,
grading, fail-stop checks, evidence ordering, and workspace cleanup belong to
`src/application/evaluation/`. Git revision reads, client processes, command
translation, and evidence files are injected capabilities. Backup freshness,
local/off-box integrity, artifact selection, encrypted-manifest idempotency,
plaintext retention, and manifest ordering belong to
`src/application/operations/`. Infrastructure retains the AES streams, checksums,
files, and SSH mechanisms. The package allowlist excludes the relocated evaluation
folders and their composition entry, preserving the original eval-only scope.

Historical module paths remain outward compatibility facades. Existing commands
still use `src/cli.ts`, `src/mcp/server.ts`, `src/app/server.ts`,
`src/app/worker.ts`, `src/db/migrate.ts`, and the six files under `scripts/`.
Migration SQL remains physically anchored at `src/db/migrations/` and
`src/db/schema.sql`. Configuration keys, database schema, lockfile, and synchronous
ingestion behavior are unchanged. This refactor does not activate the paused
product dispatcher or automatic recovery runtime.

[`../architecture-map.json`](../architecture-map.json) assigns every production
`src/**/*.ts`, SQL asset, and `scripts/**/*.{ts,sh}` file to a layer and context.
Tests, fixtures, documentation, installed dependencies, and generated `dist/`
files are outside this production inventory. Add a map entry when adding a
runtime file. The TypeScript AST gate checks type imports, re-exports, dynamic
imports, local aliases, historical facades, cross-context dependencies, and
inventory omissions. Its negative controls exercise those failures. The export
snapshot records all 104 historical TypeScript modules from commit `5a26b40`.

Run the local structure and compatibility checks with:

```bash
npm exec -- vitest run tests/architecture
npm run typecheck
```

Behavior checks remain the existing package suites. Real PostgreSQL and pgvector
suites require their explicit test environment variables; a structure check or a
unit test pass does not replace those integration results.

MCP stdio, MCP Streamable HTTP at `/mcp`, and JSON HTTP under `/v1/*`
share the service registry. `src/application/tools/tool-handlers.ts` combines
memory behavior with `src/application/tools/audit-handlers.ts`,
`src/application/tools/compact-handlers.ts`,
`src/application/tools/goal-run-handlers.ts`, and
`src/application/tools/store-handlers.ts`. Repository selection lives in
`src/application/tools/tool-repository-access.ts`.

## Data flow: write

```
Client          Tool                Orchestrator       Repos                Stores
──────          ────                ────────────       ─────                ──────
add_memory  →  add_memory tool  →  writeCanonical  →  memory-repo      →  Postgres (sources, memory_records, entity graph)
                                   Memory             canonical-       →  Postgres (memory_chunks)
                                                      indexing
                                                      ingestJobs       →  Postgres (ingest_jobs: write-ahead pending)
                                                      embeddings.embed →  transformers / openai / local
                                                      vectorIndex      →  Qdrant or pgvector (chunk vectors)
                                                      ingestJobs       →  Postgres (ingest_jobs: mark completed)
```

MCP transports also expose capability-gated context helpers. `list_workspace_roots`
uses the client's `roots/list` capability when advertised; `add_memory_interactive`
uses MCP form elicitation to collect user-confirmed memory details, then routes
accepted input through the same `add_memory` write path above.
`classify_memory_candidate` uses client sampling to suggest a memory kind and
summary for candidate text without storing it.
Those MCP-only context tools are registered from `src/interfaces/mcp/context-tools.ts`.
MCP resource templates are registered from `src/interfaces/mcp/resources.ts`; they expose
read-only recent memory and context-pack views backed by the same registry
methods as the service tools.
MCP prompts are registered from `src/interfaces/mcp/prompts.ts`; they render context-pack
startup and store-memory prompt templates without changing tool contracts.

Write-ahead outbox: after chunks are committed to Postgres,
`writeCanonicalMemory` calls `markQdrantPending` to record a scheduled
`qdrant_next_retry_at` before touching Qdrant. If the process crashes between
that point and `markQdrantCompleted`, the job row is left with
`qdrant_status='pending'` and a non-null retry timestamp so the ingest sweeper
(`src/application/usecases/ingest-sweeper.ts`, opt-in via `INGEST_SWEEP_ENABLED`) can
re-index the already-committed chunks. In-process failures still go through the
catch block (option-A delete: CASCADE removes record + chunks + job + no orphan),
so `add_memory` success/failure semantics are unchanged.

Pre-write: `assertNoSecrets(content)` runs in
`src/domain/policies/secret-scrub.ts` — refuses to persist content matching provider
API key, PEM, bearer/JWT, or credentialed database URL patterns. The check
happens in `writeCanonicalMemory` before any store touch, so a positive
detection short-circuits with no side effects.

## Data flow: read

```
search_memory  →  search tool  →  retrieveMemory  →  embeddings.embed  →  transformers / openai / local
                                  (active vector)   vectorIndex.query → Qdrant or pgvector (scope-filtered similarity)
                                  (lexical)         repository.searchMemory → Postgres scoped keyword/entity candidates
                                                    repository.getMemoryRecordsByIds → Postgres hydrate vector ids
                                                    rankCandidates → hybrid in-memory ranking
```

Org filter is applied at both the active vector backend query layer and
the Postgres lexical/hydration layers (defense-in-depth — if the vector backend
returned a cross-org point id, the PG join filters it out). Lexical candidates
use the same org and scope inputs as vector retrieval. Postgres lexical search
uses a generated `search_vector` column with a GIN index and `ts_rank_cd`, while
retaining substring fallback clauses for exact paths, env vars, and short code
tokens that full-text tokenization may miss.

The lexical scorer also extracts deterministic entity mentions (code symbols,
paths, URLs, dates, and proper nouns) so exact operational identifiers such as
`QDRANT_SNAPSHOT_TIMEOUT` or `docs/operations.md` can rescue otherwise weak
semantic matches. Those mentions are persisted at write time in `entities` and
`memory_entity_mentions`; same-record co-mentions and date contexts are stored
in `entity_relationships`. Lexical retrieval uses the persisted entity graph as
an exact-match rescue/boost path alongside FTS and substring matching.

## Data flow: compact apply

```
compact_memory dryRun=false
  ↓
applyCompaction (src/application/usecases/apply-compaction.ts)
  ├─ rate-limit check        (countRecentApplyRuns, 1/h/org default)
  ├─ createCompactionRun     (UUID idempotency_key, ON CONFLICT DO NOTHING)
  ├─ for each archive candidate:
  │    ├─ applyCompactionRecord    (single CTE: DELETE memory_records
  │    │                            + INSERT memory_archive, TOCTOU-guarded
  │    │                            by updated_at <= planGeneratedAt)
  │    ├─ qdrantClient.deletePoints
  │    └─ markQdrantStatus('deleted')
  │       (or 'pending' on Qdrant failure → sweeper picks up)
  └─ completeCompactionRun
```

Cross-store consistency: PG-first means a crash after PG commit but before
Qdrant delete leaves an orphan vector in Qdrant. The sweeper
(`src/interfaces/worker/sweeper-loop.ts`, opt-in) reconciles. Reverse order would
leave a live `memory_records` row pointing at a deleted Qdrant point — a
user-visible "search hit vanishes" bug.

The cleanup sweeper claims pending archive rows with a single
`UPDATE memory_archive SET qdrant_next_retry_at = claim_until
WHERE id IN (SELECT id FROM memory_archive FOR UPDATE SKIP LOCKED)
RETURNING id, organization_id, qdrant_point_ids, qdrant_attempt_count`
statement and pushes `qdrant_next_retry_at` into a short visibility window.
If a worker crashes after claim, the row becomes due again after that window.
Operators can run these loops inside one HTTP replica or in a dedicated
`npm run start:worker` process; both paths use the same sweeper lifecycle.

## Data flow: unarchive

```
unarchive_memory
  ↓
unarchiveCompaction (src/application/usecases/unarchive-compaction.ts)
  ├─ findArchiveByIds         (org-scoped)
  ├─ for each archive row:
  │    ├─ skip if already_unarchived / org mismatch / missing source_id
  │    ├─ restoreToCanonical  (INSERT memory_records preserving original
  │    │                       timestamps + source_id; new BIGSERIAL id)
  │    ├─ chunkText + insertChunks
  │    ├─ embeddings.embedBatch (per restored archive)
  │    ├─ qdrantClient.upsert (new point ids)
  │    ├─ chunkRepository.updatePointIds
  │    └─ markUnarchived (set unarchived_at = NOW())
```

The restore path guards provider consistency: `embedBatch` must return one
vector per stored chunk, or that archive is reported as a failed outcome.

Per-archive failure isolation: one bad restore doesn't kill the batch;
the response carries per-archive `outcomes[]` so callers see exactly
what succeeded and what didn't.

## Schema

```
sources                memory_records          memory_chunks
─────────              ──────────────          ─────────────
id PK                  id PK                   id PK
organization_id        organization_id         organization_id
scope_type             scope_type              memory_record_id FK
scope_id               scope_id                chunk_index
source_type            project_key             content
source_ref             kind                    qdrant_point_id (→ Qdrant)
captured_at            content                 embedding_provider
                       summary                 embedding_dimensions
                       durability              embedding_version
                       importance              created_at
                       source_id FK
                       created_at
                       updated_at

ingest_jobs            relationships           audit_log
───────────            ─────────────           ─────────
id PK                  id PK                   id PK
memory_record_id FK    from_memory_record_id   organization_id
organization_id        to_memory_record_id     actor / tool
status                 relation_type           outcome / error_message
attempts               created_at              duration_ms / request_id
last_error                                      metadata JSONB
qdrant_status                                   created_at
qdrant_attempts
qdrant_next_retry_at
qdrant_last_error

compaction_runs        memory_archive
───────────────        ──────────────
id PK                  id PK
organization_id        compaction_run_id FK
actor                  organization_id
scope_type/id          source_record_id (former memory_records.id)
dry_run                source_id (loose ref to sources)
status                 archive_reason ('duplicate'|'decay')
archived/duplicate/    qdrant_point_ids TEXT[]
  decay/qdrant_failed  qdrant_status ('pending'|'deleted'|'failed')
                       qdrant_attempt_count
plan_generated_at      qdrant_cleaned_at
started_at             original_created_at / original_updated_at
completed_at           archived_at / unarchived_at
idempotency_key UUID   UNIQUE (compaction_run_id, source_record_id)

entities              memory_entity_mentions  entity_relationships
────────              ──────────────────────  ────────────────────
id PK                 memory_record_id FK      id PK
organization_id       entity_id FK             organization_id
kind                  organization_id          from_entity_id FK
normalized            mention_text             to_entity_id FK
display_text          created_at               relation_type
first_seen_at                                  evidence_memory_record_id FK
last_seen_at                                   valid_from / valid_to
                                               confidence / created_at

memory_tags           goal_runs                goal_run_iterations
───────────           ─────────                ───────────────────
memory_record_id FK   id PK                    id PK
organization_id       organization_id          goal_run_id FK
tag                   scope_type/id            organization_id
created_at            project_key              iteration_index
updated_at            goal                     attempt
                      termination_criteria     outcome
memory_records        status                   summary / error
goal_run_id FK        iteration_count          created_at
                      close_note
                      created_at / updated_at
                      closed_at
```

Migrations live in `src/db/migrations/`. The current range is `001-016`;
the runner applies `001` through `016` on bootstrap (each is idempotent,
`CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
The source of truth is `MIGRATION_FILES` plus the mirrored
`embeddedPostgresMigrationSql` fallback in `src/infrastructure/postgres/migrate.ts`; the older
`src/db/schema.sql` is a historical SQLite/FTS artifact, not the active
Postgres schema.
`009_memory_archive_qdrant_retry.sql` supplies archive Qdrant retry metadata,
including `qdrant_next_retry_at` and the pending-retry index used by the
background archive cleanup sweeper. `010_postgres_full_text_search.sql` adds
the generated `search_vector` column and GIN index used by lexical retrieval.
`011_entity_temporal_graph.sql` adds persistent entity mention and temporal
relationship tables used by graph-backed lexical rescue.
`012_memory_governance_tags.sql` adds org-scoped `memory_tags` for governance
filtering and vector payload metadata refreshes. `013_add_goal_runs.sql` adds
first-class goal runs, ordered iterations, and `memory_records.goal_run_id`
pinning for active-run compaction protection. `014_add_goal_run_close_note.sql`
stores the resolution/reason note used when a goal run is completed or
abandoned. `015_background_queue_metrics_indexes.sql` adds partial indexes that
keep `/metrics` background queue backlog gauges from scanning historical
`ingest_jobs` and `memory_archive` rows.

`016_memory_revalidation.sql` adds inert JSONB revalidation snapshots to canonical
and physical archive rows. Record-digest checks protect metadata edits; external
source freshness remains unknown. See [the API contract](api-reference.md#reported-recheck-metadata).

## Multi-tenancy

Every record-bearing table has `organization_id TEXT NOT NULL`. SQL queries
include `WHERE organization_id = $org` in every read and write path. Bearer
tokens in `MEMORY_API_TOKENS` may bind to an org with `:org` syntax — when
present, the token's org overrides body / header values; mismatch is 403.

**Org enforcement on all read paths.** `retrieveMemory` (search),
`listMemory` (used by `compact_memory`), and `getMemoryRecordsByIds`
(vector-hydration step) all throw when `organizationId` is undefined and
the operator has not set `LEGACY_ANONYMOUS_SEARCH=true`. This means an
unbound token (no `:org` in `MEMORY_API_TOKENS`, no `x-organization-id`
header, no body org) cannot silently read across tenants — it receives a
clear operational error describing all three remediation paths. The shared
`assertOrganizationId` helper (`src/domain/policies/assert-organization-id.ts`)
enforces this consistently across all three entry points.

The `organization_id` written into `memory_archive` during apply is read
from the canonical record itself (RETURNING from the DELETE), not from
the caller token — defense-in-depth against the unlikely case where a
token's bound org disagrees with a record's org.

## Audit trail

Every tool invocation produces an `audit_log` row via the `instrument()`
wrapper in `src/application/tools/tool-registry-instrumentation.ts`. The row captures org,
actor, tool name, project key, outcome (`ok`/`error`), error message, duration
ms, request id, and (for destructive operations) `metadata` JSONB with
structured detail (archived ids, run ids, etc.).

Reads via `list_audit_log` are org-scoped — entries from other orgs never
leak. Writes are best-effort (failures don't block the user request) but
logged at error level so ops can detect audit-stream issues.

## Vector backend pluggability

`src/composition/runtime/canonical-services.ts` selects the vector backend via
`VECTOR_BACKEND` (default: `qdrant`):

- `qdrant` **(default)** → `src/infrastructure/vector/qdrant-index.ts`, wraps
  `@qdrant/js-client-rest`. Requires `QDRANT_URL` + `QDRANT_API_KEY`.
- `pgvector` → `src/infrastructure/vector/pgvector-index.ts`, stores embeddings in
  Postgres using the `vector` extension. Reuses the existing PG pool —
  **no second service needed**. Qdrant credentials are not required.
  `ensureCollection(dims)` verifies the `vector` extension is already
  installed, then creates the table and HNSW/BTree indexes at bootstrap;
  subsequent restarts are no-ops (`CREATE … IF NOT EXISTS`).

Both adapters implement the `VectorIndex` interface
(`src/application/ports/vector-index.ts`): `ensureCollection`, `upsert`, `query`,
`delete`. Filter translation (`VectorFilter` → Qdrant `must` / SQL
`WHERE`) is encapsulated inside each adapter so no Qdrant or pgvector
SQL dialect leaks into orchestration code.

`buildVectorPoint` assigns every chunk a deterministic UUIDv8-shaped point ID,
injectively derived from its positive safe-integer chunk ID. The literal ID is
shared by Qdrant and pgvector and is stable across retries and reindexing; no
SQL migration is required. Reindexing converges legacy point IDs.

### Postgres-only deploy

Set `VECTOR_BACKEND=pgvector` to run Akasha on a single Postgres
instance with no Qdrant service. The local compose override
`compose.pgvector.yaml` swaps in `pgvector/pgvector:pg16`:

```bash
docker compose -f compose.yaml -f compose.pgvector.yaml up -d
```

**Switching backends requires a reindex** (`reindex_memory` tool) —
vector dimensions and content topology differ between backends.

## Embedding pluggability

`src/composition/runtime/embedding-factory.ts` selects the provider via
`EMBEDDING_PROVIDER` (default: `transformers`):

- `transformers` **(default)** → `src/infrastructure/embedding/transformers-embedding.ts`,
  free local ONNX inference via the installed `@huggingface/transformers`
  package.
  Default model `Xenova/all-MiniLM-L6-v2`, 384-dim. First call downloads
  ~22 MB to the HF cache; subsequent calls are fully offline. No API key
  required.
- `openai` → `src/infrastructure/embedding/openai-embeddings.ts`,
  `text-embedding-3-small`, 1536-dim. Requires `OPENAI_API_KEY`.
- `local` → `src/infrastructure/embedding/local-embedding.ts`, deterministic SHA-256
  hashing into 384-dim vectors. No external calls; intended for CI /
  air-gapped / offline use where semantic search is not needed.

The provider is selected at bootstrap and held in `services.embeddings`
for the process lifetime. Changing provider requires a reindex
(`reindex_memory` tool) because dimensions and content semantics differ.
