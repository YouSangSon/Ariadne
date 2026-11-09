> [English](architecture.md) | **한국어**

# 아키텍처

이 문서는 Akasha의 구조와 데이터 흐름을 설명합니다. 도구별 API 디테일은
[api-reference.ko.md](api-reference.ko.md), env 변수 셋업은
[configuration.ko.md](configuration.ko.md) 참고.

## 레이어

메모리 패키지는 하나의 경계 컨텍스트입니다. 메모리, 목표 실행, 엔티티 언급,
검색, 압축이 같은 모델과 조직 권한 규칙을 공유합니다. 내부 폴더는 독립 서비스가
아니라 책임을 구분합니다.

| 소유 위치 | 책임 |
| --- | --- |
| `src/domain/model/` | 메모리, 출처, 목표 실행, 압축, 벡터 값. |
| `src/domain/policies/`, `src/domain/evaluation/` | 비밀 거부, 범위 검증, 청크 분할, 순위, 중복 탐지, 시간 감쇠, 문맥 선택과 결정론적 평가 지표. |
| `src/application/contracts/`, `src/application/ports/` | 전송 방식과 무관한 명령·결과, 저장소·임베딩·벡터·쓰기·로그·사용자 식별·프로젝트 출처의 타입 계약. |
| `src/application/tools/`, `src/application/usecases/`, `src/application/indexing/` | 도구 동작, 검색, 원본 인덱싱, 압축, 복원과 재시도 흐름. |
| `src/application/lifecycle/`, `src/application/ingest/`, `src/application/evaluation/`, `src/application/operations/` | 초기화 파일 계획, 동기 출처 수집, 평가 파싱·채점·영수증 검사, 백업·복원 검증. |
| `src/infrastructure/` | PostgreSQL SQL과 세션, 벡터·임베딩 어댑터, 파일, 프로세스 실행, 설정, 사용자 식별, 상태 검사와 로그 출력. |
| `src/interfaces/` | HTTP·MCP 계약, 인증, 스키마, CLI·운영 명령과 worker 타이머. |
| `src/composition/runtime/` | 제공자 선택, 원본 서비스 생성과 registry·worker·수집·초기화의 기본 연결. |

Domain은 domain만, application은 domain과 application만 가져옵니다.
Infrastructure는 안쪽 포트를 구현하고 전송 어댑터와 조립 코드가 이를 연결합니다.
안쪽 코드는 과거 호환 경로, MCP·HTTP SDK, 파일·프로세스 어댑터, 환경 설정,
PostgreSQL pool·query 인터페이스를 가져오지 않습니다. Application에서 순수 경로,
해시, 비교 연산은 `node:path`, `node:crypto`, `node:util`을 사용합니다.

`MemoryWriteCoordinator`는 record, archive, create, restore 작업을 제공합니다.
PostgreSQL 구현은 하나의 세션을 예약하고 같은 세션으로 쓰기 범위의 모든 저장소와
pgvector 어댑터를 생성합니다. Advisory lock, 트랜잭션 콜백, 인덱싱 의도, 보상 처리와
벡터 정리는 이 쓰기 범위 안에서 함께 유지합니다. 일반 SQL 실행기를 유스케이스에
전달하면 이 보장을 잃으므로, application은 타입을 지정한 저장소와 쓰기 범위를 받습니다.

서비스 명령·결과는 `application/contracts/tools.ts`가 소유합니다. MCP 전용 roots,
elicitation, sampling, 권한 DTO는 `interfaces/mcp/contracts.ts`에 있습니다.
HTTP와 MCP는 계속 같은 서비스 스키마와 registry를 사용하며 조직 검사와 오류 동작을
유지합니다.

평가 코퍼스 구성, 사전 메모리 적재, 프로필·유료 실행 조건, 채점, 실패 시 중지,
근거 저장 순서와 작업 폴더 정리는 `src/application/evaluation/`이 소유합니다.
Git 리비전 읽기, 클라이언트 프로세스, 명령 변환과 근거 파일은 포트로 전달합니다.
백업의 유효 기간, 로컬·외부 사본 무결성, 암호화 대상 선택, 암호화 manifest의
멱등성, 평문 보존과 manifest 저장 순서는 `src/application/operations/`가 소유합니다.
Infrastructure는 AES 스트림, 체크섬, 파일과 SSH 실행을 담당합니다.
패키지 허용 목록은 이동한 평가 폴더와 조립 진입점도 제외해 기존 평가 전용 범위를 유지합니다.

기존 모듈 경로는 바깥쪽 호환 진입점으로 유지합니다. 명령은 계속 `src/cli.ts`,
`src/mcp/server.ts`, `src/app/server.ts`, `src/app/worker.ts`, `src/db/migrate.ts`와
`scripts/`의 여섯 파일을 사용합니다. SQL 자산은 `src/db/migrations/`와
`src/db/schema.sql`에 그대로 있습니다. 환경 설정 키, 데이터베이스 스키마, lockfile과
동기 수집 동작을 유지합니다. 중지된 제품 dispatcher나 자동 복구 런타임을 활성화하지 않습니다.

[`../architecture-map.json`](../architecture-map.json)은 모든 운영
`src/**/*.ts`, SQL 자산, `scripts/**/*.{ts,sh}` 파일의 계층과 컨텍스트를 지정합니다.
테스트, fixture, 문서, 설치된 의존성과 생성된 `dist/`는 이 운영 목록에서 제외합니다.
운영 파일을 추가하면 소유 항목도 추가해야 합니다. TypeScript AST 검사는 타입 import,
재노출, 동적 import, 로컬 별칭, 과거 호환 경로, 컨텍스트 간 의존성과 누락 파일을 검사합니다.
실패 조건을 주입하는 음성 대조 검사도 포함합니다. 공개 export 스냅샷은 커밋 `5a26b40`의
기존 TypeScript 모듈 104곳을 기록합니다.

구조와 공개 이름 호환성은 다음 명령으로 확인합니다.

```bash
npm exec -- vitest run tests/architecture
npm run typecheck
```

동작은 기존 패키지 테스트로 검증합니다. 실제 PostgreSQL·pgvector 검사는 명시적인 테스트
환경 변수가 필요하며 구조 검사나 단위 테스트 통과로 대체할 수 없습니다.

MCP stdio, `/mcp`의 MCP Streamable HTTP, `/v1/*`의 JSON HTTP가 같은
서비스 registry를 사용합니다. `src/application/tools/tool-handlers.ts`는
메모리 동작과 `src/application/tools/audit-handlers.ts`,
`src/application/tools/compact-handlers.ts`,
`src/application/tools/goal-run-handlers.ts`,
`src/application/tools/store-handlers.ts`를 연결합니다. 저장소 선택은
`src/application/tools/tool-repository-access.ts`가 소유합니다.

## 데이터 흐름: 쓰기

```
클라이언트       도구                오케스트레이터       Repo                Store
──────         ────                ────────────       ─────              ──────
add_memory →  add_memory tool   →  writeCanonical →  memory-repo     →  Postgres (sources, memory_records, entity graph)
                                   Memory            canonical-      →  Postgres (memory_chunks)
                                                     indexing
                                                     ingestJobs      →  Postgres (ingest_jobs: write-ahead pending)
                                                     embeddings.embed→  transformers / openai / local
                                                     vectorIndex     →  Qdrant 또는 pgvector (chunk vector)
                                                     ingestJobs      →  Postgres (ingest_jobs: mark completed)
```

MCP transport는 capability-gated context helper도 노출합니다.
`list_workspace_roots` 는 클라이언트가 광고한 `roots/list` capability를 사용하고,
`add_memory_interactive` 는 MCP form elicitation으로 사용자 확인 memory detail을
수집한 뒤, accept된 입력을 위와 같은 `add_memory` write path로 보냅니다.
`classify_memory_candidate` 는 client sampling으로 candidate text의 memory kind와
summary를 제안하며 저장은 하지 않습니다.
이 MCP-only context tool 등록은 `src/interfaces/mcp/context-tools.ts` 에 있습니다.
MCP resource template 등록은 `src/interfaces/mcp/resources.ts` 에 있으며, service tool과
같은 registry method로 read-only recent memory와 context-pack view를 노출합니다.
MCP prompt 등록은 `src/interfaces/mcp/prompts.ts` 에 있으며, tool contract를 바꾸지 않고
context-pack startup과 store-memory prompt template을 렌더링합니다.

Write-ahead outbox: chunk이 Postgres에 커밋된 후, `writeCanonicalMemory` 는
Qdrant 에 접근하기 전에 `markQdrantPending` 을 호출해 `qdrant_next_retry_at`
를 예약합니다. 이 시점과 `markQdrantCompleted` 사이에 프로세스가 크래시되면,
job row 는 `qdrant_status='pending'` + 재시도 타임스탬프를 갖고 남아 ingest
sweeper(`src/application/usecases/ingest-sweeper.ts`, `INGEST_SWEEP_ENABLED` opt-in)가
이미 커밋된 chunk를 재인덱스할 수 있습니다. 인-프로세스 오류는 기존처럼
catch 블록(option-A 삭제: CASCADE가 레코드·chunk·job을 제거, 고아 없음)을
통해 처리되므로 `add_memory` 의 성공/실패 의미는 변경되지 않습니다.

쓰기 전: `src/domain/policies/secret-scrub.ts` 의 `assertNoSecrets(content)` —
provider API key / PEM / bearer/JWT / 자격증명이 포함된 데이터베이스 URL 패턴
매칭 시 거부. `writeCanonicalMemory` 의 어떤 store touch보다도 앞에서 실행 →
매칭 시 사이드 이펙트 없이 short-circuit.

## 데이터 흐름: 읽기

```
search_memory →  search tool  →  retrieveMemory  →  embeddings.embed →  transformers / openai / local
                                 (active vector)   vectorIndex.query → Qdrant or pgvector (scope-filtered similarity)
                                 (lexical)         repository.searchMemory → Postgres scope keyword/entity 후보
                                                   repository.getMemoryRecordsByIds → Postgres vector id hydrate
                                                   rankCandidates → hybrid in-memory 랭킹
```

Org 필터는 활성 vector backend 쿼리 레이어와 Postgres lexical/hydration 레이어
(defense-in-depth — vector backend가 cross-org point id를 반환해도 PG join에서
필터링) 양쪽 모두에 적용. Lexical 후보는 vector retrieval과 같은 org/scope
입력을 사용. Postgres lexical search는 GIN 인덱스가 있는 generated
`search_vector` 컬럼과 `ts_rank_cd`를 사용하며, full-text tokenization이 놓칠 수
있는 정확한 path / env var / 짧은 code token을 위해 substring fallback도 유지합니다.

Lexical scorer는 code symbol, path, URL, date, proper noun 같은 deterministic
entity mention도 추출합니다. 그래서 `QDRANT_SNAPSHOT_TIMEOUT` 또는
`docs/operations.md` 같은 정확한 운영 식별자가 약한 semantic match를 보강할 수
있습니다. 이 mention은 write 시점에 `entities`, `memory_entity_mentions` 에
영속화되고, 같은 record 안의 co-mention 과 날짜 context는
`entity_relationships` 에 저장됩니다. Lexical retrieval은 FTS와 substring
matching 옆에서 이 persistent entity graph를 exact-match rescue/boost 경로로
사용합니다.

## 데이터 흐름: compact apply

```
compact_memory dryRun=false
  ↓
applyCompaction (src/application/usecases/apply-compaction.ts)
  ├─ rate-limit 체크         (countRecentApplyRuns, 기본 1/h/org)
  ├─ createCompactionRun     (UUID idempotency_key, ON CONFLICT DO NOTHING)
  ├─ archive 후보별:
  │    ├─ applyCompactionRecord    (단일 CTE: DELETE memory_records
  │    │                            + INSERT memory_archive,
  │    │                            updated_at <= planGeneratedAt TOCTOU 가드)
  │    ├─ qdrantClient.deletePoints
  │    └─ markQdrantStatus('deleted')
  │       (Qdrant 실패 시 'pending' → sweeper가 처리)
  └─ completeCompactionRun
```

Cross-store 일관성: PG-first 는 PG commit 후 Qdrant delete 전 크래시 시
Qdrant에 orphan vector 남김. sweeper (`src/interfaces/worker/sweeper-loop.ts`, opt-in)
가 reconcile. 역순은 살아있는 `memory_records` 가 삭제된 Qdrant point를
가리키는 사용자 가시 버그.

cleanup sweeper는 단일
`UPDATE memory_archive SET qdrant_next_retry_at = claim_until
WHERE id IN (SELECT id FROM memory_archive FOR UPDATE SKIP LOCKED)
RETURNING id, organization_id, qdrant_point_ids, qdrant_attempt_count`
문으로 pending archive row를 claim하고 `qdrant_next_retry_at`을 짧은
visibility window로 밀어둡니다. claim 이후 worker가 크래시되어도 window가
끝나면 row가 다시 due 상태가 됩니다.
운영자는 이 loop를 HTTP replica 하나 안에서 실행하거나 전용
`npm run start:worker` 프로세스로 실행할 수 있으며, 두 경로 모두 같은 sweeper
lifecycle을 사용합니다.

## 데이터 흐름: unarchive

```
unarchive_memory
  ↓
unarchiveCompaction (src/application/usecases/unarchive-compaction.ts)
  ├─ findArchiveByIds         (org-scoped)
  ├─ archive 행별:
  │    ├─ already_unarchived / org mismatch / source_id 없음 시 skip
  │    ├─ restoreToCanonical  (원본 timestamp + source_id 보존하며
  │    │                       memory_records INSERT; 새 BIGSERIAL id)
  │    ├─ chunkText + insertChunks
  │    ├─ embeddings.embedBatch (복원 archive별)
  │    ├─ qdrantClient.upsert (새 point id)
  │    ├─ chunkRepository.updatePointIds
  │    └─ markUnarchived (unarchived_at = NOW() 설정)
```

복구 경로는 provider 일관성을 가드합니다. `embedBatch` 는 저장된 chunk마다
정확히 하나의 vector를 반환해야 하며, 개수가 다르면 해당 archive만 failed
outcome 으로 보고합니다.

Archive 별 실패 격리: 한 archive 복원 실패가 batch 전체를 죽이지 않음;
응답에 archive별 `outcomes[]` 포함 → 호출자가 정확히 무엇이 성공/실패했는지
파악 가능.

## 스키마

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
scope_type/id          source_record_id (이전 memory_records.id)
dry_run                source_id (sources에 대한 loose ref)
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

마이그레이션은 `src/db/migrations/` 에 위치. 현재 범위는 `001-016` 이며,
런너는 부트스트랩 시 `001` 부터 `016` 까지 적용합니다 (모두 idempotent,
`CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
source of truth는 `src/infrastructure/postgres/migrate.ts` 의 `MIGRATION_FILES` 와 mirror된
`embeddedPostgresMigrationSql` fallback입니다. 오래된 `src/db/schema.sql` 은
historical SQLite/FTS artifact이며 active Postgres schema가 아닙니다.
`009_memory_archive_qdrant_retry.sql` 은 archive Qdrant retry metadata를
제공하며, `qdrant_next_retry_at` 과 백그라운드 archive cleanup sweeper가
사용하는 pending-retry 인덱스를 포함합니다. `010_postgres_full_text_search.sql`
은 lexical retrieval이 사용하는 generated `search_vector` 컬럼과 GIN 인덱스를
추가합니다. `011_entity_temporal_graph.sql` 은 graph-backed lexical rescue가
사용하는 persistent entity mention 및 temporal relationship 테이블을 추가합니다.
`012_memory_governance_tags.sql` 은 governance 필터링과 vector payload metadata
갱신에 쓰이는 org-scoped `memory_tags` 를 추가합니다. `013_add_goal_runs.sql` 은
first-class goal run, ordered iteration, active-run compaction 보호용
`memory_records.goal_run_id` pinning을 추가합니다. `014_add_goal_run_close_note.sql`
은 goal run 완료/포기 시 resolution/reason note를 저장합니다.
`015_background_queue_metrics_indexes.sql` 은 `/metrics` background queue backlog
gauge가 historical `ingest_jobs`, `memory_archive` row를 스캔하지 않도록 partial
index를 추가합니다.

`016_memory_revalidation.sql`은 원본과 물리 보관 행에 실행하지 않는 JSONB 재확인
메타데이터를 추가합니다. 레코드 digest로 메타데이터 수정을 검사하며 외부 원본의
최신성은 미확인입니다. [API 계약](api-reference.ko.md#재확인-방법과-보고된-의존성-저장).

## 멀티-테넌트

레코드 보유 테이블 모두 `organization_id TEXT NOT NULL` 을 가짐. 모든 read /
write 경로의 SQL 쿼리에 `WHERE organization_id = $org` 포함. `MEMORY_API_TOKENS`
의 bearer 토큰은 `:org` 문법으로 org 바인딩 가능 — 존재 시 토큰의 org가 body /
헤더 값을 덮어씀; mismatch 는 403.

**모든 읽기 경로에 org 강제 적용.** `retrieveMemory` (검색), `listMemory`
(`compact_memory` 에서 사용), `getMemoryRecordsByIds` (벡터 하이드레이션
단계) 는 모두 `organizationId` 가 undefined 이고 운영자가
`LEGACY_ANONYMOUS_SEARCH=true` 를 설정하지 않은 경우 에러를 던집니다. 즉,
언바운드 토큰 (`:org` 없음, `x-organization-id` 헤더 없음, body org 없음) 은
테넌트 경계를 넘어 자동으로 데이터를 읽을 수 없으며, 세 가지 해결 방법을
안내하는 명확한 운영 에러를 받습니다. 공유 헬퍼 `assertOrganizationId`
(`src/domain/policies/assert-organization-id.ts`) 가 세 진입점 모두에서 일관되게 이를
강제합니다.

apply 시 `memory_archive` 에 쓰이는 `organization_id` 는 caller 토큰이 아닌
canonical 레코드 자체에서 (DELETE의 RETURNING) 읽음 — 토큰의 바인딩 org와
레코드의 org가 다른 (드물지만 가능한) 케이스에 대한 defense-in-depth.

## Audit trail

모든 도구 호출은 `src/application/tools/tool-registry-instrumentation.ts` 의 `instrument()`
wrapper를 통해 `audit_log` 행 생성. 행에는 org, actor, 도구 이름, project
key, outcome (`ok`/`error`), 에러 메시지, duration ms, request id 포함;
destructive operation 의 경우 `metadata` JSONB 에 구조화된 디테일 (archive id,
run id 등).

`list_audit_log` 읽기는 org-scoped — 다른 org의 entry는 누출되지 않음.
쓰기는 best-effort (실패해도 사용자 요청은 차단 안 함) 이지만 error 레벨
로그로 ops가 audit-stream 이슈 감지 가능.

## 벡터 백엔드 플러거빌리티

`src/composition/runtime/canonical-services.ts` 가 `VECTOR_BACKEND` 를 통해 벡터 백엔드
선택 (기본값: `qdrant`):

- `qdrant` **(기본)** → `src/infrastructure/vector/qdrant-index.ts`,
  `@qdrant/js-client-rest` 래핑. `QDRANT_URL` + `QDRANT_API_KEY` 필요.
- `pgvector` → `src/infrastructure/vector/pgvector-index.ts`, `vector` 확장을 사용해
  Postgres 에 임베딩 저장. 기존 PG pool 재사용 — **두 번째 서비스 불필요**.
  Qdrant 자격증명 불필요. `ensureCollection(dims)` 는 부트스트랩 시
  `vector` 확장이 이미 설치되어 있는지 확인한 뒤 테이블과 HNSW/BTree 인덱스를
  생성합니다 — 재시작 시 no-op (`CREATE … IF NOT EXISTS`).

두 어댑터 모두 `VectorIndex` 인터페이스 (`src/application/ports/vector-index.ts`) 구현:
`ensureCollection`, `upsert`, `query`, `delete`. 필터 변환 (`VectorFilter` →
Qdrant `must` / SQL `WHERE`) 은 각 어댑터 내부에 캡슐화 — Qdrant 또는
pgvector SQL 방언이 오케스트레이션 코드에 누출되지 않음.

`buildVectorPoint` 는 양의 safe-integer chunk ID에서 단사적으로 유도한
결정론적 UUIDv8 형태 point ID를 각 chunk에 부여합니다. 이 리터럴 ID는 Qdrant와
pgvector가 그대로 공유하고 재시도·재인덱싱에도 안정적이며 SQL 마이그레이션은
필요 없습니다. 재인덱싱은 legacy point ID를 수렴시킵니다.

### Postgres 단독 배포

`VECTOR_BACKEND=pgvector` 설정으로 Qdrant 서비스 없이 단일 Postgres 인스턴스
만으로 Akasha 실행 가능. 로컬 compose 오버라이드 `compose.pgvector.yaml`
이 `pgvector/pgvector:pg16` 로 전환:

```bash
docker compose -f compose.yaml -f compose.pgvector.yaml up -d
```

**백엔드 전환 시 reindex 필수** (`reindex_memory` 도구) — 백엔드 간 벡터
차원과 컨텐츠 토폴로지가 다름.

## Embedding pluggability

`src/composition/runtime/embedding-factory.ts` 가 `EMBEDDING_PROVIDER` 를 통해
provider 선택 (기본값: `transformers`):

- `transformers` **(기본)** → `src/infrastructure/embedding/transformers-embedding.ts`,
  설치된 `@huggingface/transformers` package 기반 무료 로컬 ONNX 추론.
  기본 모델 `Xenova/all-MiniLM-L6-v2`, 384-dim. 첫 호출 시 HF 캐시에
  ~22 MB 다운로드; 이후 완전 오프라인 동작. API 키 불필요.
- `openai` → `src/infrastructure/embedding/openai-embeddings.ts`,
  `text-embedding-3-small`, 1536-dim. `OPENAI_API_KEY` 필요.
- `local` → `src/infrastructure/embedding/local-embedding.ts`, 결정론적 SHA-256 해싱
  → 384-dim 벡터. 외부 호출 없음; 시맨틱 검색이 불필요한 CI /
  air-gapped / 오프라인 환경용.

provider는 부트스트랩 시 선택되어 프로세스 lifetime 동안 `services.embeddings`
에 보관. provider 변경 시 reindex (`reindex_memory` 도구) 필요 —
dimension 과 컨텐츠 의미 다름.
