# Ariadne 하네스 합성 설계

## 1. 목표와 설계의 경계

사용자가 일을 맡기면 필요한 능력과 자료만 선택하고, 중단해도 검증한 지점에서 이어 가며, 결과를 얻는 데 든 전체 비용을 설명하는 구조를 만든다. 20개 저장소를 기능별로 복제하지 않는다. 서로 잘 맞는 원리를 결합하고, 각 원리의 약점에는 별도의 확인 장치를 둔다.

**이 문서는 구현 전 설계다.** 기준 소스는 `c39065d`다. 이미 구현된 스킬 선택과 기록 비교는 출발점이며 전체 적용의 완료가 아니다. 새 자동 실행기, 공급자 호출, 설치, 권한 확대를 활성화하지 않는다.

읽는 순서: [현재 상태](#2-현재-구조와-실제-차이) → [결합 원리](#3-장점을-결합하고-약점을-상쇄하는-방법) → [사용 경험과 책임](#4-사용-경험과-소유-경계) → [상세 계약](#5-상세-계약) → [창의적 실험](#6-새롭게-조합한-실험) → [구현 순서](#8-구현-순서와-중단-기준). 출처 전수 연결과 인수 사례는 부록에 둔다.

### 정본과 기존 결정

| 근거 | 유지할 결정 | 이번 설계의 역할 |
| --- | --- | --- |
| 사용자: 통합 하네스, 원하는 일과 토큰 낭비 감소 | 코딩뿐 아니라 조사·문서·분석을 다룸 | Git 없는 작업을 같은 완료 계약으로 표현 |
| 사용자: DDD·클린 아키텍처·선택 모듈·MSA 확장 | 모듈별 데이터 소유, 안쪽으로 향하는 의존성 | 기존 모듈을 합성하고 서비스 분리는 조건부로 남김 |
| 사용자: 무조건 따라하지 말고 장점 결합·단점 상쇄·창의적 고려 | 이식 개수가 아닌 실제 효과로 채택 판단 | §3의 보완 관계와 §6의 반증 가능한 실험 |
| [제품 방향](product-direction.md) | 완료 품질을 지킨 전체 사용량 감소 | 기능을 늘리는 데 든 하네스 자체 비용도 측정 |
| [실행 정책](execution-policy.md)·[통합 실행 설계](unified-execution-design.md) | 현재 승인, Task 전체 예산, 최대 실행 2개, 같은 공간 writer 1개, unknown 보존 | 기존 UEP/UES를 변경하지 않고 후속 계약에 연결 |
| [전체 리팩토링 설계](full-refactor-design.ko.md) | 모듈형 모놀리스와 여러 인프라의 명시적 연결 | DB·브로커·전역 서비스 로케이터를 기본 의존성으로 추가하지 않음 |
| [출처 검토와 기존 구현](harness-engineering-adoption.md) | 선택한 스킬 hash, 필수 문맥 예산, 비교 조건·누락 사용량 보존 | 기존 기능을 호환 확장하며 과거 구현 증거와 새 설계를 구분 |

HS-D 식별자는 이번 **설계 판단**이며 사용자가 항목별로 승인한 새 정책을 뜻하지 않는다. HS-S는 그 판단에서 도출한 **예정 검증 사례**다. 기존 UEP/UES는 원래 정본을 참조한다. 새 보존 기한·과금 한도·공급자 허가·원격 배포 권한을 이 문서에서 정하지 않는다.

## 2. 현재 구조와 실제 차이

현재 호출은 `bin/Ariadne.mjs` → `core/domain/product.mjs`의 명령 선택 → 각 CLI → application → domain/port → 파일·DB adapter 순서다. CLI는 호출한 프로젝트의 cwd를 보존한다. context는 REQ·handoff·결정과 명시 선택한 스킬을 조립하며, memory/code/ontology 검색을 자동으로 합성하지 않는다.

| 영역 | 실제 구현과 근거 | 부족한 부분 |
| --- | --- | --- |
| 목표·검증 조건 | `modules/requirements/{domain,application,files}.mjs`: canonical REQ, 계약 hash, Git 기반 sourceState | Git 없는 입력 snapshot과 자료별 검증 의존성 |
| 문맥·스킬 | `modules/context/`: 메타데이터, `slug@sha256`, 전체 본문, 예산·scrub | 명시적 참고 자료 선택, 선택 이유, 공급자 간 중복·충돌·최신성 관리 |
| 설치 | `modules/integration/`: 소유 manifest, 생성 미러, 백업·제거 | 외부 요소의 출처/호환성 검토와 변경 계획. 자동 다운로드 기능은 없음 |
| 훅 | `hooks/commit-message.mjs`, `handoff-check.mjs`, `session-start.mjs` | 현재 조기 경보이며 오류 시 허용한다. 효과를 막는 강제 승인 경계가 아님 |
| 실행 기반 | `modules/loop/native.mjs`: `unattended:false` 수동 패킷. API transport·파일 helper 존재 | Task controller·효과 기록·자동 복구·완료 봉인 없음. helper 존재는 실행 qualification이 아님 |
| 메모리·코드·온톨로지 | 각 소유 모듈의 저장·검색. ontology는 lexical 검색, digest 및 current/stale/unreviewed | 근거 후보를 문맥으로 연결하는 명시적 조립. ontology의 current는 사실성·권한 인증이 아님 |
| 평가 | `evaluation/comparison.mjs`: 기록된 사례 비교. 기존 제어군 검사 | 실행기에서 관측한 usage·검증 근거 수집, 비코딩 평가, 비교 실험 계획 |

부록 B의 기존 테스트는 이 표의 범위를 고정한다. 단위 테스트가 존재한다고 자동 실행·보안 격리·실사용 절감까지 검증된 것으로 보지 않는다.

재사용 기능을 새로 만드는 것으로 오해하지 않는다. Code의 `packages/code/src/application/context/persist-pack.ts`는 index run·예산·탐색 범위·변경 파일 hash·Git snapshot으로 문맥 재사용을 식별하고, `context-for-change.ts`는 참조 응답을 제공한다. Memory의 `packages/memory/src/application/tools/context-pack-result.ts`는 안정된 기억을 작업 문맥보다 앞에 배치한다. 이 구현을 각 owner 안에 유지하고, 공통 context는 공개 결과의 참조·권한·가용성을 연결한다. 내부 helper를 다른 모듈에서 직접 import하지 않는다.

### 구조 대안과 선택 — HS-D01

| 대안 | 숨기는 복잡도 / 호출자 부담 | 실패·운영 비용 | 판단 |
| --- | --- | --- | --- |
| A. 기존 모듈을 확장하고 먼저 감독하에 사용 | 기존 CLI를 유지. 문맥·근거는 합성하지만 실행 수명은 사용자가 확인 | 작게 출시 가능. 공통 snapshot 계약 없이 진행하면 수동 상태·hash 규칙이 분산될 위험 | 첫 전달 단계의 기반 |
| B. 공통 Task controller부터 구축 | 하나의 작업 명령 뒤에 승인·실행·검증·복구를 숨김 | 사용자 흐름은 단순하지만 DB·소유권·프로세스·격리를 한꺼번에 검증해야 효용 발생 | 자동 실행의 최종 책임 경계로 채택, 첫 단계 선행조건으로 만들지 않음 |
| C. 외부 프레임워크·플러그인 묶음 도입 | 빠른 기능 시연 가능. 호스트별 설정·권한·업데이트를 사용자가 조정 | 중첩 루프·중복 비용·라이선스·공급자 결합·제거 복잡성 | 제외. 필요한 기법만 자체 계약으로 구현 |

합성 방향은 **A의 단계적 전달 + B의 단일 실행 권위**다. 지금부터 같은 작업 snapshot과 근거 식별자를 쓰되, 수동 패킷에 승인·완료 권위를 부여하지 않는다. 자동화 단계에서만 기존 `modules/loop`가 상태 변경·슬롯·예산을 원자적으로 관리한다. 같은 책임의 두 실행 루프를 운영하지 않는다.

평가 기준은 정책 보존, 실제 코드 연결, 부분 실패 안전성, 전체 비용의 관측 가능성, 결합 최소화다. 처리량·절감률을 측정한 점수표가 아니다. 독립 대안 검토의 결과와 남은 위험은 §10에 기록한다.

## 3. 장점을 결합하고 약점을 상쇄하는 방법

아래 여덟 조합이 설계의 중심이다. 각각 여러 출처를 결합하며, 규칙을 추가하는 비용도 함께 제한한다. S01~S20의 정확한 저장소는 부록 A에서 찾는다.

| 조합 | 가져올 장점 | 단독 적용의 약점 → 상쇄 장치 | Ariadne의 결과 |
| --- | --- | --- | --- |
| HS-D02 필요한 능력과 지침 | S01 단계적 스킬 읽기 + S04 지침 범위 + S06 과설계 억제 | 자동 트리거 오탐·지침 충돌·본문 팽창 → 명시 선택 우선, 적용 이유·범위, 제한된 참고 자료, 충돌 표시 | 사용자가 선택·생략 이유와 비용을 확인하는 문맥 계획 |
| HS-D03 출처와 관계에 따른 재사용 | S05 과제 문맥 + S12 읽기 상태 구분 + 기존 ontology/memory/code | 오래된 요약·누락 자료·검색 결과의 권위 상승 → 원본 revision·관계·권한을 재확인하고 의존 범위만 무효화 | 다시 읽을 자료와 다시 할 검사를 구분 |
| HS-D04 조기 경보와 실제 차단 | S07 수명주기 훅 + S08 제한적 정책 + S02 완료 증거 | 훅 미발화·오류 시 허용·셸 문자열 우회 → advisory와 host guard를 별도 경계로 유지 | 경보는 보조, 실행 허가는 현재 Grant와 검증된 host 경계가 판단 |
| HS-D05 전문 역할과 작은 위임 | S09 역할 정의 + S10 독립 평가 + S13 작은 작업 | 역할 과다·중복 탐색·통합 충돌 → 기본 단일 실행, 자식의 산출물·소유권·예산·수용 조건 명시 | 역할 개수보다 실제 조정 비용을 포함한 위임 판단 |
| HS-D06 지속성과 재개 | S13 외부 진행 기록 + S14 실행 대조 + S12 진행점 관리 | 무한 재시도·종료 오인·중복 외부 효과 → 같은 handle 조회, 원인 변화 검사, unknown 예약 유지 | 중단 지점에서 이어 가되 미확정 행동은 반복하지 않음 |
| HS-D07 결과와 전체 비용 | S15 trial 식별 + S16 실제 과제 검증 + S17 비교 조건 + S01 스킬 대조 | 보기 좋은 합격률·누락 비용·평가 과적합 → 실패 포함, 미측정 유지, 분리된 검사기·보류 과제 | 검증된 성과당 전체 사용량을 비교하고 인과 과장은 배제 |
| HS-D08 안전한 도입과 제거 | S11 출처 검사 + S03/S20 후보 발견 + 기존 install manifest | 목록 등재를 신뢰·설치 허가로 오인 → revision·개별 라이선스·변경 diff·호환성 확인 | 외부 코드 없이 시작하고, 추후 명시적 가져오기도 소유 파일만 관리 |
| HS-D09 작은 학습과 운영 지식 | S18 단계적 실습 + S19 점검 목록 + S02 검증 절차 | 체크리스트·기억의 무한 증가 → 실제 반복 실패와 회귀 사례가 있는 개선만 후보화 | 지식은 제안으로 남고, 모델이 전역 규칙·권한을 스스로 고치지 않음 |

장점을 결합한다고 모든 규칙을 매 호출마다 실행하지 않는다. 소스·조건이 같으면 유효한 검증을 재사용하며, 계약·권한·필수 입력이 바뀌면 관련 판정부터 다시 한다. 새 모델 라우터나 검토 호출이 절약하려던 비용을 넘으면 해당 기능을 축소한다.

## 4. 사용 경험과 소유 경계

### 사용자가 경험할 세 가지 흐름

1. **자료로 보고서 작성:** 사용자가 자료와 출력 위치를 지정한다. REQ에 결론·출처·정확성 기준을 기록한다. 문맥 계획은 필요한 자료와 스킬을 보여 준다. 자료를 읽지 못하면 빈 자료로 처리하지 않는다. 작성·검증 후 로컬 결과를 남기며 외부 발송은 별도 승인이다.
2. **기존 코드 수정:** Git 입력과 패키지 검사를 기존대로 사용한다. 수정한 파일이 어떤 검증에 영향을 주는지 근거가 충분할 때만 검사 재사용을 추천한다. 불완전한 의존성 지도면 기존 전체 검사를 보존한다.
3. **작업 이어 가기:** 이전 패킷·검증·handle과 현재 입력을 대조한다. 확인된 결과와 변경된 자료를 분리한다. 실행 종료나 효과가 unknown이면 조회만 하고 새 실행은 대기한다. 사용자 중지는 명시 재개 전까지 유지한다.

아래는 구현 방향을 설명하는 **내부 의사 호출**이다. 새 CLI/SDK의 현재 사용법이 아니다. `Ariadne context`, `skills`, `eval compare`의 기존 인자·출력은 유지하며, 새 출력이 필요하면 명시적 형식 옵션이나 version을 추가한다.

```ts
const task = requirements.snapshot(reqRef, inputSelection)
const pack = await context.prepare(task, explicitSkills, authorizedSources)
// 초기 단계: pack을 감독하에 전달. 패킷 생성은 실행 승인이 아니다.
const reuse = verification.assess(task, observations, currentScope)
// 아래 taskId는 P4에서 controller가 접수한 작업의 ID다. 위 snapshot이 발급하지 않는다.
// 자동화 단계: 이미 확정한 runtime.check / complete / status와 같은 판정기 사용.
const attempt = await runtime.check(taskId, checkKey, approvedObservationRequest)
const result = await runtime.complete(taskId)
```

### 책임 지도

| 소유자 | 추가·확장 책임 | 소유하지 않는 것 |
| --- | --- | --- |
| `modules/requirements` | TaskSpec: 기존 REQ에서 만든 불변 목표·AC·gate와 입력 선택 | 실행 상태·새 승인·비용 정산 |
| `modules/context` | ContextPlan, 선택 이유, 자료 가용성·필수성·예산, 문맥 조립 | 완료 판정·도구 실행·원본 지식 수정 |
| `modules/integration` | 호스트 지침 범위 정보, 설치·출처·소유 파일 계획 | 호스트보다 높은 권한, 임의 전역 설정 |
| `modules/loop` | 기존 목표 설계의 Run·Effect·CheckAttempt·Receipt·Task 예산, 승인·실행·복구 | 메모리/코드 DB 직접 접근, 두 번째 agent 내부 루프 |
| `evaluation` | 관측 기록 검증·쌍 비교·평가 계획·비용 보고 | 런타임의 승인·완료 상태 변경, 제안의 자동 승격 |
| memory / code / ontology / wiki | 자기 자료와 검색·근거의 revision, 권한 및 정합성 | 다른 모듈 원본 쓰기, 공통 Task의 성공 선언 |
| composition·entrypoint | 선택한 포트를 정적으로 연결, 버전·기능 검사 | 도메인 규칙 재구현, 문자열 이름으로 임의 plugin 로드 |

새 공유 framework는 만들지 않는다. 모듈 간에는 작고 version이 있는 값과 명시한 application 포트를 전달한다. 안쪽 모듈이 기존 façade를 역으로 import하지 않으며 `architecture-map.json`의 소유·의존성 검사를 확장한다. 도메인별 내부 transaction·SQL·HTTP 객체를 공통 타입에 노출하지 않는다.

## 5. 상세 계약

### 5.1 목표와 입력을 고정한다 — HS-D10

**책임:** requirements가 REQ의 의미와 입력 identity를 소유한다. Git 없는 작업에서도 문서 폴더와 선택 자료로 snapshot을 만든다. REQ 상태와 런타임 Task 상태는 별개다.

| 의사 타입 | 필요한 값과 판정 |
| --- | --- |
| TaskSpec | 감독 사용의 읽기 전용 snapshot: `schema_version, snapshot_digest, req_ref, contract_hash, criteria, required_checks, input_manifest_ref`. P4에서만 별도 `runtime_binding: {task_id, task_revision}` 연결 |
| InputManifest | `version, scope_ref, entries, selection_rule, completeness` — 자료별 owner·locator·revision/hash·종류·필수성 |
| SourceObservation | `available / empty / unavailable / denied / stale / unknown`, 관측 시각·원인·원본 참조 |
| CheckScope | 명령/관측 방법, 실제 도구 identity·cwd·의존성·유효 설정 fingerprint, 읽는 입력·선택 규칙 |

InputManifest의 각 entry는 기존 전체 설계의 `ResourceSnapshotRef`를 사용한다. 소유자·불투명 ID·revision·content digest·접근 범위·보존 수명을 유지하며 별도의 경쟁 참조 타입을 만들지 않는다. TaskSpec은 REQ에서 파생한 읽기 전용 값이다. TaskController의 상태·revision 부여와 구분하고, 기존 Memory goal-run API가 canonical Task 또는 Task 소유 조회 투영을 변경하지 못하는 계약도 유지한다.

`snapshot_digest`는 canonical 목표 계약과 선택한 입력 manifest로 계산한 내용 식별자다. P1에서는 Task ID·단조 증가 taskRevision을 발급하지 않는다. P4의 `task_revision`은 store가 목표·완료 계약 변경에 부여하며 파일 hash나 heartbeat로 대체하지 않는다. 입력 변경은 새 snapshot을 만들지만 그 자체로 새로운 작업 승인이나 Task revision을 만들지 않는다. P4 접수는 snapshot 내용과 현재 승인을 다시 대조하여 runtime binding을 부여하고, 외부 패킷이 제출한 binding을 신뢰하지 않는다.

새 문서를 생성하는 비Git 작업은 입력 선택과 출력 경로를 먼저 분리한다. 출력이 입력 glob에 들어가 자기 snapshot을 계속 바꾸는 경우에는 별도 출력 경로 또는 명시한 산출물 제외 규칙을 요구하고, 해결 전 snapshot을 거절한다. 산출물 자체 검사는 별도 output dependency로 유지한다. 기존 소스를 편집하는 코딩 작업은 이 제외 대상이 아니며 변경 소스·dirty 상태를 그대로 검증한다. 지침·입력·검사 파일을 임의 제외해 검사를 약화하지 않는다.

`completeness`는 목록 완전성을 검증했는지 나타낸다. 원격 pagination 실패·접근 거절을 빈 목록으로 숨기지 않는다. 폴더 membership을 검증하는 작업은 기존 파일 hash뿐 아니라 선택 규칙과 파일 추가·삭제도 입력에 포함한다. Git 작업의 tracked/dirty/untracked, mode·종류 검사는 기존 계약을 유지한다.

hash는 변경 탐지용이며 안전성·승인·자료의 진실성을 인증하지 않는다. 원격 자료의 revision 신뢰성이 부족하면 작업 snapshot 안의 바이트를 보존하고 다음 사용 때 다시 확인한다. URL이 같다는 이유로 영구 재사용하지 않는다. 원본 관측이 불가능하면 unknown으로 남긴다.

**예외:** 지원하지 않는 REQ 문법을 추론하지 않는다. 범위를 모르는 입력은 재사용 판정을 거절한다. 범위 확대·AC 변경은 REQ revision으로 남기며 모델이 통과를 위해 기준을 낮추지 못한다. 초기 입력 manifest는 명시 선택한 로컬 자료로 제한하고, 원격 수집 adapter는 qualification 후 추가한다.

### 5.2 필요한 문맥을 선택하고 설명한다 — HS-D02·03

**책임:** context는 선택 목록과 실제 보낼 패킷을 일치시킨다. 외부 지침을 실행 권한으로 바꾸지 않는다.

```ts
type ContextPlan = {
  version: 1; snapshot_digest: string; contract_hash: string;
  runtime_binding?: { task_id: string; task_revision: number };
  selected: ContextItem[]; omitted: Omission[]; blockers: Reason[];
  manifest_hash: string; estimated_tokens: number | null;
  measured_utf16_units: number; measured_bytes: number;
}
type ContextItem = {
  source_ref: string; source_hash: string; kind: string;
  required: boolean; selected_by: 'user' | 'rule' | 'suggestion';
  reason: string; applicability_ref: string; trust: 'reference';
}
```

1. 명시 선택과 필수 목표·제약·검증을 먼저 보존한다. 자동 추천은 선택 후보이며 사용자 지시를 덮지 않는다. 초기 선택은 명시 값과 결정론 규칙으로 시작한다.
2. 본문에 적힌 링크를 모두 따라가지 않는다. 허용한 참고 파일만 기존 guarded reader로 읽고 hash를 고정한다. `scripts`는 읽기/실행을 구분하며 자동 실행하지 않는다. 원격 링크는 승인된 수집 경로 밖에서 조회하지 않는다.
3. 호스트 adapter가 제공한 지침의 출처·적용 경로·우선순위 정보를 보존한다. Claude/Codex/Cursor의 의미를 한 전역 순서로 추정하지 않는다. 호스트 계약을 확인하지 못한 지침은 참고 자료로만 취급한다. 같은 적용 범위에서 모순이 발견되면 그 부분을 blocker로 표시한다. 모든 자연어 충돌의 자동 탐지를 보장하지 않는다.
4. 같은 owner·범위·원본 hash의 바이트 중복만 결정론적으로 제거할 수 있다. 역할이 다른 제한·반례·최신 정정은 문장이 비슷하다고 제거하지 않는다. 새 요약에는 원본 연결과 검증 상태를 남긴다.
5. 의미 손실 없이 필수 내용을 담을 수 없으면 패킷 생성을 거절한다. UTF-16 예산·직렬화 byte 상한을 각각 검사한다. tokenizer가 없으면 토큰 수는 미측정이다.
6. model transport 직전 [통합 실행 설계 §11.2](unified-execution-design.md#112-승인자료-반출실제-효과의-책임을-분리한다)의 전체 payload 반출 검사를 적용한다. 목록·reason·경로·오류에도 scrub을 적용하고 원본 내부 fingerprint는 모델에게 불필요하게 노출하지 않는다.

**예외:** 선택 자료 장애는 이유를 남기고 제외할 수 있으나 필수 자료 장애는 관련 결과 생성을 막는다. 프로젝트·조직의 권한은 자료 소유 adapter에서 매번 확인한다. memory-only 사용에 code 인덱싱을 요구하지 않는다. 없는 모듈을 자동 설치하지 않는다.

### 5.3 검증 근거를 의존 범위에 따라 재사용한다 — HS-D03

**책임:** 문맥의 출처 그래프와 검증의 유효성을 구분한다. context는 자료 관계를 반환하고, 기존 통합 실행 설계의 `modules/loop/verification.mjs` 예정 판정기가 검사 재사용·완료를 소유한다. 초기 감독 사용에서는 같은 순수 판정 결과를 설명하지만 권위 있는 Receipt로 승격하지 않는다.

P3의 수동 입력에는 `provenance: reported`와 `history_coverage: unknown`을 붙인다. 사용자 파일의 배열 순서·timestamp·자기 보고 순번으로 최신 시작을 인증하지 않는다. P4 이전에는 기존 결과를 후보로 보여 줄 수 있지만, 생략된 새 시도가 없는지 확인할 수 없으면 `reuse: unknown`이다. 이런 후보로 필수 검사를 자동 생략하거나 verified를 기록하지 않는다. `reusable`은 controller가 관측한 시작 순서·현재 이력 version·artifact·scope를 대조할 수 있을 때만 반환한다. 순수 판정기의 합성 fixture 통과는 실제 기록의 완전성 인증이 아니다.

| 관계 | 사용 | 잘못 사용하면 안 되는 것 |
| --- | --- | --- |
| 자료 → 주장 | 어느 주장이 바뀐 자료에 의존하는지 찾음 | 링크가 있다는 이유로 주장이 사실이라고 인증 |
| 입력·도구·환경 → 검사 결과 | 재실행할 검사 선택 | 코드 graph만 보고 읽지 않은 외부 의존성 생략 |
| 결과 → AC/gate | 완료 기준의 근거를 추적 | 하나의 테스트로 모든 AC 충족 추정 |
| 스킬·선택 계획 → 실행 기록 | 어떤 조합이 결과에 기여했는지 비교 | 상관관계를 원인·승인으로 취급 |

전체 `manifest_hash`는 작업 snapshot의 출처를 식별한다. 검사 재사용에는 별도 `dependency_projection_hash`를 쓴다. 이는 해당 check가 읽는 입력·membership 선택 규칙과 그 version에서 파생하며, validator가 확인한 의존 범위가 완전할 때만 부분 투영을 허용한다. 검사별 재사용 키는 이 projection과 현재 Task revision, 계약/검사계획, verifier·tool/config/environment, actor scope를 함께 포함한다. 모델이 제안한 관계만으로 완전성을 인정하지 않는다. 의존성이 불완전하면 전체 source/manifest hash를 사용한다. 기존 Git sourceState의 전체 hash 동작도 이 조건을 만족하기 전까지 보존한다.

예를 들어 검사 A가 자료 A만 읽는다고 확인했고 B가 바뀌었다면, 전체 manifest는 바뀌어도 검사 A의 projection은 유지될 수 있다. A와 B를 합치는 최종 보고서 검사는 둘 모두에 의존하므로 다시 실행한다. 새 Receipt는 현재 전체 manifest와 각 check의 projection·재사용 출처를 함께 연결한다. 권한은 현재 판정하며 최신 시작 시도의 실패·진행·unknown은 같은 check의 과거 성공을 가린다. 새 파일이 영향을 주는 집계는 목록 선택 규칙도 dependency로 포함한다.

최종 Receipt는 관측한 immutable snapshot에 대한 완료다. 외부 원본이 그 뒤 바뀌지 않았다는 영구 보증이 아니다. 현재 원본과의 일치 여부는 마지막 확인 시각·revision·`receiptValid`로 표시하고, 확인할 수 없으면 unknown이다. 완료·무효화는 같은 control store에서 순서를 정한다. 과거 Task의 completed 상태와 현재 근거 유효성을 분리하여 자료 변경이 자동 재실행을 일으키지 않게 한다.

온톨로지는 용어·관계 후보를 찾는 데 쓰고 검증 의존성의 권위 있는 저장소로 바꾸지 않는다. 원본 관계는 각 owner가 보존하며 필요한 작은 adjacency 목록만 합성한다. 그래프 DB·벡터 검색은 필수가 아니다. 일반 검색 관련성과 필수 검사 의존성을 같은 점수로 합치지 않는다.

**예외:** 원본 삭제·revocation·membership 변화·artifact 유실은 관련 근거의 재사용을 막는다. 변경하지 않은 다른 근거는 남기되 그 사실만으로 최종 산출물이 유효하다고 보지 않는다. 검증의 캐시는 새 입력을 권위 있는 기록에 덮어쓰지 않는다.

### 5.4 경보·승인·효과를 분리한다 — HS-D04

**책임:** 기존 hooks는 사용자의 실수를 일찍 알린다. 자동화의 host guard는 현재 Grant와 실제 행동을 대조한다. 기존 fail-open 훅을 수정했다고 전체 도구를 안전하게 차단했다고 주장하지 않는다.

| 경계 | 실패 시 동작 | 보존할 계약 |
| --- | --- | --- |
| advisory hook | 경보 실패를 관측, 기존 host 흐름 유지 | 검증/CI의 대체물이 아니며 Stop을 재주입하지 않음 |
| 자동 효과 host guard | 승인·대상·정책을 확인 못하면 새 효과 거절 | allow 판정의 오류를 허용으로 바꾸지 않음 |
| 완료 판정 | 필수 최신 근거가 없으면 완료 거절 | 완료 문자열·모델 보고·exit 0 하나로 완료하지 않음 |
| 원격 연결 | 접수/결과를 모르면 unknown | 즉시 재발사·예약 해제 금지 |

행동은 shell 문자열이 아니라 승인된 operation·resource·목적지·인자 hash로 제한한다. 임의 shell의 모든 위험을 regex로 판별하려 하지 않는다. native host가 현재 승인·철회·하위 실행을 통제하지 못하면 수동 감독으로 남긴다. 최초 API model 경로의 제한된 파일 도구 정책을 확대하지 않는다.

정책을 조합할 때는 상위 허용 범위의 교집합 안에서만 하위 설정이 좁힐 수 있다. 신뢰되지 않은 스킬·댓글·결과의 allow 선언은 무시한다. 설정 snapshot은 검증 후 교체하되, 권한 철회는 이전 정상 snapshot을 계속 쓰는 근거가 될 수 없다. 현재 권한을 확인할 수 없으면 새로운 효과를 차단한다.

### 5.5 위임과 재시도는 진전에 기여할 때만 사용한다 — HS-D05·06

**책임:** `modules/loop`가 선택 실행의 소유권과 Task 예산을 유지한다. 역할 카드와 하네스 안의 프롬프트는 권한 부여 수단이 아니다.

위임 단위는 `task_ref, parent_run, role, input_refs, output_contract, owned_resources, requested_capabilities, verification_plan, budget_slice`다. 사용자가 지정한 모델·effort를 먼저 따르고 role 파일의 하드코딩 값은 설정으로 가져오지 않는다. 기본은 실행기 하나다. 독립 읽기·명확한 소유 산출물처럼 병렬 이득이 있는 경우에만 위임을 고려한다. 비용 근거가 없으면 절약을 보장하지 않는다.

자식 결과는 제안·artifact·근거 참조이며 승인/완료 상태를 직접 바꾸지 않는다. 부모는 소스·contract·artifact를 대조해 수용한다. 같은 workspace writer는 하나이며, 자식도 전역 2개 상한과 같은 Task 예산을 사용한다. 부모 대기 시 슬롯 양도는 실제 suspend 지원을 확인한 경우만 허용한다. 외부 agent 내부 child를 셀 수 없으면 무인 위임을 비활성화한다.

재시도 판단은 [통합 실행 설계 §12.1](unified-execution-design.md#121-실패-분류와-진전-근거로-재시도를-판정한다)을 따른다. `failure_kind + operation/check key + error class + relevant input/config/source`와 실제 바뀐 근거를 연결한다. 관련 없는 README 수정이나 새 run ID는 진전이 아니다. 일시 조회 오류에는 승인된 backoff를 사용할 수 있지만, 접수된 효과가 unknown이면 같은 handle을 관측한다. 새 검사 약화·skip으로 성공을 만들지 않는다.

### 5.6 진행 기록과 외부 효과를 보존한다 — HS-D06

**책임:** 자동화의 유일한 원본은 기존 설계의 host control DB다. 수동 handoff와 프로젝트 projection은 재개 자료일 뿐 승인·실행 소유권의 원본이 아니다.

원자적으로 묶는 것은 Task revision·현재 정책·run admission·슬롯·writer·예산 예약이다. 파일 artifact는 먼저 작업 소유 위치에 완성하고 hash를 확인한 뒤 DB에 참조한다. DB commit 전 crash한 파일은 orphan이며 성공 근거가 아니다. 전용 owner 잠금과 epoch는 [통합 실행 설계 §7.1](unified-execution-design.md#71-복구에서도-dispatcher-소유권을-하나로-유지한다), 구버전 offline 전환은 [§10.2](unified-execution-design.md#102-기존-기록과-schema를-보존한다)를 따른다. 새 event-sourcing 시스템을 만들지 않는다.

Effect의 idempotency key는 `scope + task + logical_operation`에 속하며 request hash가 다르면 충돌 오류다. 재시도나 새 run이 key를 바꿔 같은 효과를 새 작업처럼 발사하지 못한다. key·결과는 작업 기록의 수명 동안 보존하며 자동 TTL 삭제를 도입하지 않는다. 실제 원격 공급자의 dedup 기간이 더 짧으면 보장 종료 이후 재실행을 막고 관측/사용자 판단으로 넘긴다.

외부 알림은 intent 저장 → 현재 승인 확인 → 접수 → 관측된 결과 기록 순서다. 응답을 잃으면 unknown으로 남긴다. 전달이 확인되기 전에 처리 cursor를 전진시키지 않는다. 수신 자료를 읽은 cursor와 외부 발송 cursor는 별개다. 전역 exactly-once를 주장하지 않고, 로컬 중복 억제와 공급자 보장 범위를 구분한다.

중지 시 새 배정 차단 → 소유 실행/child 중지 요청 → 같은 handle로 종료/효과 확인 → 근거와 정산 저장 → 소유 임시 자원 정리 순서다. cleanup 실패는 별도 blocker다. 공유 Podman machine·connection·volume, 사용자 `.parallax`, 메모리 DB를 캐시로 지우지 않는다.

### 5.7 관측 가능한 평가를 먼저 만든다 — HS-D07

**책임:** evaluation은 잘못된 성공 보고와 실제 효과를 구분한다. 기존 v1 비교 JSON은 입력자가 보고한 자료라는 의미를 유지한다. 실행 관측 수집은 별도 version의 envelope로 연결하고, 해시만으로 신뢰도를 자동 높이지 않는다.

평가 계획에는 고정 과제·입력·검사기·모델/effort·환경·하네스 조합, 반복 계획, 순서, 예산, 중단 조건을 기록한다. 같은 과제를 서로 다른 조합으로 실행하되 사용자 자료와 외부 효과는 격리한다. 순서 효과를 줄이기 위해 순서를 교차시키고 실행 시점·provider 차이를 기록한다. 코딩·조사·문서 작업을 각각 포함한다.

비용은 준비·검색·라우팅·본문 실행·검토·실패·재시도·자식 호출을 Task에 귀속한다. 사용량 identity는 `provider + account_ref + endpoint_ref + request_id + meter_scope`다. 부모와 자식이 같은 identity를 보고하면 한 번 계상하고, 다른 계정의 같은 request ID를 합치지 않는다. 비밀 원문을 identity에 저장하지 않는다. 같은 meter의 누적 관측을 매번 합산하지 않으며 공급자 계약상 확인된 최종값을 사용한다. 관측이 충돌하거나 ID·포함 관계를 확인 못하면 합계를 unknown으로 둔다. 공급자 input/output 정의와 cache/reasoning 포함 여부를 보존한다. 성공 0건의 성공당 비용은 null이다.

검사기는 worker가 정답·기대값을 고치지 못하는 위치에 둔다. 정적 구조 검사, 실행 결과 검사, 사람의 품질 판단은 별도 축이다. 인용 존재 검사는 의미적 지지의 충분조건이 아니므로, 조사 과제는 정정 반영·출처 상충을 고정 fixture와 사람 검토로 확인한다. LLM judge 하나를 정답으로 쓰지 않는다.

도입 기준은 필수 안전 사례에서 회귀 0건, 동일 기준의 과제 품질 유지, 관측 가능한 총비용/지연의 개선이다. 숫자 목표는 실제 기준선과 분산을 확인한 실험 계획에서 고정한다. 지금 임의 절감률이나 통계적 유의성을 약속하지 않는다. 실패·timeout·unknown을 좋은 결과만 남기려고 분모에서 빼지 않는다. 검증기 자체 고장은 별도 표시하고 그 실행으로 우월성을 주장하지 않는다.

### 5.8 출처를 확인하고 안전하게 제거한다 — HS-D08·09

**책임:** integration은 외부 능력을 발견하는 것, 검토하는 것, 설치하는 것을 구분한다. 기존 source manifest를 활용하고 별도 마켓플레이스·자동 updater를 만들지 않는다.

초기 개선은 자체 코드이며 외부 본문을 복사하지 않는다. 후속 명시 가져오기에는 origin URL·고정 revision·content hash·개별 license·지원 호스트·필요 capability·소유 파일을 남긴다. 라이선스 미확인·변경·수집 콘텐츠 조건은 확인 전 반입하지 않는다. 출처 표의 MIT 표기가 하위 콘텐츠 전체의 허가를 뜻하지 않는다.

업데이트는 새 내용을 별도 위치에서 검증하고 변경 계획을 보여 준다. 활성 실행의 selection은 기존 hash에 고정한다. 새 grant·모델 정책을 설정 파일에서 자동 적용하지 않는다. 제거는 설치 manifest와 현재 내용의 동일성을 대조한 소유 파일만 대상으로 한다. 사용자가 바꾼 파일·backup·근거 원본은 보존하고 충돌을 보고한다.

반복 실패에서 얻은 개선은 원인·반례·예상 효과·검사·소유 문서가 있는 후보로 기록한다. 전역 스킬 자동 수정이나 사용자 전체 대화 수집은 하지 않는다. 재발하지 않는 일시 오류마다 새 규칙을 추가하지 않는다. 폐기해도 필수 권한·검증을 약화하지 않는 선택 요소만 제거 실험의 대상이다.

## 6. 새롭게 조합한 실험

아래는 Ariadne에서 새로 조합한 제안이다. 원본 저장소의 완성 기능이나 이미 검증된 발명으로 소개하지 않는다. 자동 적용보다 작은 반증 실험을 먼저 한다.

| 제안 | 결합 방식과 예시 | 반증·중단 기준 | 우선순위 |
| --- | --- | --- | --- |
| HS-X01 요소를 빼서 기여도를 확인 | 스킬 선택 + paired eval. 선택 스킬 하나를 뺀 결과와 유지한 결과를 같은 과제로 비교 | 반례·정정 대응·필수 품질이 나빠지면 제거안 폐기. 실제 모델 실험은 승인 예산 필요 | 먼저 오프라인 설계, 관측 수집 후 실험 |
| HS-X02 바뀐 사실만 다시 검토 | ontology의 출처 관계 + source hash + 검증 scope. 보고서 자료 B 수정 시 B에 의존한 주장과 검사만 재검토 | dependency 누락 대조에서 누락 발생 시 해당 범위 전체 재검증으로 복귀 | 로컬 명시 manifest부터 |
| HS-X03 막힌 이유에 맞는 정보만 요청 | 실패 분류 + 역할 위임 + context 계획. “정보 부족” 대신 어느 AC의 어느 자료가 없고 어디에 요청할지 제시 | 미확인 원인을 사실처럼 추정하거나 정보 요청 비용이 재작업보다 크면 단순 수동 설명으로 축소 | 결정론 오류·누락 사유부터 |
| HS-X04 실행하지 않고 계획을 비교 | 같은 기록에 새 문맥·라우팅 정책을 적용해 예상 선택·충돌·크기 차이를 offline replay | 실제 성공률·모델 비용·외부 효과의 결과는 replay로 증명 불가. 살아 있는 도구 호출은 금지 | 자동 실행 전 사용 가능 |
| HS-X05 불확실성을 완료 기준에 연결 | 자료별 available/unknown + 주장/AC 연결. “보고서 완료” 대신 확인한 결론과 필수 미확인 항목 구분 | 불확실성 표시만 하고 필수 AC를 통과시키면 실패. 확률 점수로 권한·정확성 대체 금지 | 비코딩 첫 경로에 포함 |

X01은 보호 규칙을 빼는 탐색이 아니다. X02는 의미적 의존성을 완벽히 알아낸다는 약속이 아니다. X04에서 비용 추정과 관측 비용을 별도 필드로 표시한다. 모든 실험의 결과는 추천이며, 사용자가 정한 모델·권한·예산을 자동 변경하지 않는다.

## 7. 규모·인프라·운영 가정

초기 대상은 신뢰하는 로컬 작업 공간과 단일 호스트다. 실제 작업 크기·성공률·지연·빈도 분포는 미측정이다. 아래 상한은 성능 보장이 아니라 기존 검증 경계이며, 초과하면 명시적으로 거절한다.

| 항목 | 현재 경계 | 설계에 미치는 영향 |
| --- | --- | --- |
| 스킬 | 최대 100개 발견, 64 KiB/파일, 20개 선택 | 첫 단계에서 유지. 대규모 카탈로그는 측정 후 별도 탐색 설계 |
| Git 입력 | 최대 10,000파일·합계 64 MiB | 비Git manifest도 명시 상한·전체 목록 검사를 적용하고 과대 입력을 조용히 샘플링하지 않음 |
| ontology | 1,000 terms·5,000 relations·32 source 파일 | 대규모 검증 graph를 여기에 밀어 넣지 않음 |
| 비교 기록 | 1 MiB·1,000 runs·100 attempts/run | 장기 수집은 owner 저장소에서 제한 조회 후 비교 입력으로 내보냄 |
| 동시 실행 | 전체 2, workspace writer 1이라는 목표 정책 | 새 규칙을 매 단계 LLM에 묻지 않고 로컬 결정론 판정 |

다중 DB·인증·캐시·Kafka/RabbitMQ는 [기존 확장 설계](full-refactor-design.ko.md#9-msa와-복수-인프라-확장-설계)를 따른다. 이번 기능 때문에 Redis·그래프 DB·Kafka를 필수로 넣지 않는다. 장기 owner DB와 패키지 DB는 데이터 원본이 달라 분리한다. 업무 의미를 가진 포트만 원격화하며 분산 transaction을 가정하지 않는다.

캐시를 도입할 때는 owner·tenant/project·권한 scope·query·source/selection/verifier version을 키에 포함하고 현재 권한을 다시 검사한다. 원본 변경·권한 철회·membership 변화가 무효화 조건이다. TTL은 최신성의 증거가 아니며 unavailable을 empty로 저장하지 않는다. 정책과 동등성 관측이 충분하지 않으면 캐시 없이 진행한다.

브로커는 나중에 event stream과 작업 queue의 역할로 각각 연결할 수 있다. 메시지 중복·역전·재전달을 가정하며 stable event ID, aggregate revision, inbox/outbox를 owner가 처리한다. ACK는 durable 반영 뒤에 수행한다. 교차 broker 원자적 전송·전역 순서는 보장하지 않는다. 이 adapter는 실제 필요·부하·실패 복구 실험을 확인한 뒤 별도 구현 단위로 둔다.

인증 공급자는 identity를 확인하고 각 모듈은 자기 resource 권한을 판정한다. 로컬 workspace ID를 memory organization ID로 추정 매핑하지 않는다. 서비스 분리 시 actor·tenant·목적·deadline을 전달하되 caller가 제출한 tenant를 권한 근거로 믿지 않는다. 서비스 간 credential·추가 보존 기한·운영 비용은 배포 단위에서 별도 결정한다.

RTO/RPO·처리량 SLO·자동 데이터 삭제 기한은 미확정이다. 이에 기대는 자동 운영은 활성화하지 않는다. 설계의 첫 단계는 유료 공급자·원격 서비스 없이 검증 가능하다. Podman은 필요한 통합 검증에만 사용하고 작업 소유 label·리소스 ID로 정리한다.

## 8. 구현 순서와 중단 기준

단계 수는 기능 개수가 아니다. 각 단계는 사용자가 쓸 수 있는 결과와 다음 단계의 검증 근거를 남긴다. 이번 요청은 이 계획의 구현을 시작하라는 승인이 아니다.

| 단계 | 전달 결과·변경 owner | 의존성과 완료 기준 | 실패 시 복귀 |
| --- | --- | --- | --- |
| P0 현재 계약 고정 | requirements/context/integration/evaluation의 특성화와 호환 fixture | 기존 두 기능·REQ 상태·CLI stdout/exit·설치 closure 유지, 아래 HS-S01~04 기대 결과 고정 | 기존 c39065d 동작 유지 |
| P1 Git 없는 목표·입력 | requirements의 InputManifest와 기존 REQ 변환 | 명시 로컬 자료로 작업 표현, membership·읽기 실패 검사. 기존 sourceState export 보존 | 새 manifest 경로만 비활성화 |
| P2 설명 가능한 문맥 | context의 선택 계획·명시 참고 자료·소유 source 포트, integration의 host profile | P1. 필수성·권한·예산·충돌 검증. 처음엔 files+ontology, memory/code는 공개 계약으로 순차 연결 | 기존 명시 스킬만 쓰는 context 유지 |
| P3 근거 기반 재개 | loop의 순수 검증 판정·감독 패킷, eval의 provenance envelope | P1. 최신 실패·의존 범위·원본 유실의 fixture 검사. 수동 이력 완전성 미확인은 reuse unknown이며 필수 검사 생략 불가 | 재사용을 끄고 전체 필요한 검사 수행 |
| P4 하나의 공통 작업 실행 | 기존 A2/E1~E4를 준수하는 loop controller, SQLite owner·상태·예약·guard | P1/P3. fake adapter의 crash/unknown/stop/경합 검증 후 한 adapter 실제 qualification. 비코딩 로컬 보고서를 첫 공통 Task 사례로 추가 | 새 접수 차단·관측/수동 모드, 기록은 보존 |
| P5 효용 검증과 제한 위임 | 평가 입력 수집·코딩/조사/문서 과제·X01~05, 필요시 자식 1개 | 감독 실험은 P2/P3부터 가능. 자동 위임은 P4 및 child 관측·격리 qualification 필요 | 품질 회귀 조합 제거, 단일 실행 유지 |
| P6 후속 이벤트와 선택 원격화 | 기존 A6의 observe/inbox/outbox, 실제 필요가 있는 source/broker adapter | P4/P5의 효과·중복·정산 검증, 외부 실행·발송별 승인 | observe-only, 수동 대조 |

구현 시 제품 코드를 한꺼번에 scaffolding하지 않는다. 첫 구현 REQ는 P0/P1의 Git 없는 입력 계약으로 제한한다. 이후 단계가 위 계약과 어긋나면 해당 설계를 먼저 갱신한다. 각 단계의 소유 runtime 파일·callers·tests·설치 manifest·architecture map·문서를 함께 변경한다. 공개 CLI/HTTP/MCP의 계약을 바꾸는 단계는 실제 호출자 대조와 version 전략을 별도 확정한다.

기존 REQ status enum·hash 계산을 바꾸지 않고 새 snapshot version으로 표현한다. 과거 verified REQ와 reported comparison은 그대로 읽되 새 receipt로 소급 인증하지 않는다. 새 persistent schema는 런타임 owner가 존재하는 P4에서 offline 전환·백업·reader/writer version 거절·롤백을 검증한다. 이번 설계가 구 초안을 migration 없이 실행하게 만들지 않는다.

## 9. 검증 계획과 완료의 의미

세 층을 구분한다. **계약 검증**은 잘못된 입력·권한·상태를 거절하는지 본다. **업무 검증**은 실제 산출물이 사용자 기준을 만족하는지 본다. **효용 평가**는 같은 품질에서 전체 비용과 재작업이 줄었는지 본다. 하나가 다른 둘의 통과를 대신하지 않는다.

| 과제 | 기대 산출물 | 반드시 섞을 실패 조건 |
| --- | --- | --- |
| 코딩 | 기존 공개 계약을 보존한 수정·관련 검사 근거 | dependency 추가, 최신 검사 실패, dirty/untracked 입력, install closure 누락 |
| 조사 | 결론과 출처가 연결된 로컬 보고서 | 오래된 근거의 정정, 접근 실패, 동명 용어, 반대 자료, 비밀 포함 출처 |
| 문서·데이터 | 지정 형식의 문서 또는 검증 가능한 계산 결과 | 빈 입력과 읽기 실패, 일부 저장 실패, 동일 요청 재개, 출력 경로 충돌 |
| 후속 업무 | 승인된 처리 기록과 관측된 전달 결과 | 응답 유실, 중복 이벤트, stop 뒤 늦은 결과, 만료 승인 |

새 테스트 파일명은 구현 시 owner 관례에 맞춰 정한다. 부록 B는 **현재 존재하는 테스트**와 **추가할 검사**를 구분한다. 시나리오를 작성했다고 테스트를 실행한 것으로 기록하지 않는다. 실제 모델/외부 서비스 실험은 사용자가 승인한 조건에서만 수행한다. 로컬 container 검증은 Podman을 쓰고 cleanup까지 완료한다.

## 10. 설계 검토 결과와 남은 경계

2026-11-06 두 독립 읽기 전용 설계 후보를 실제 소스와 대조했다. 중요 설계 리뷰는 A를 전달 순서로, B를 단일 실행 권위로 합성하는 선택에 동의했다. 리뷰에서 다음 세 계약을 보완했고, 변경 부분 재검토에서 남은 차단 사유가 없음을 확인했다.

1. P1의 내용 식별자와 P4 store가 부여하는 Task revision을 분리했다.
2. 수동 이력의 최신성·완전성을 모르면 reuse unknown으로 제한하고 필수 검사 생략을 금지했다.
3. 전체 manifest와 검사별 dependency projection을 분리해 선택적 재사용과 보수적 fallback을 함께 정의했다.

추가로 usage identity의 계정·endpoint·meter 범위, 입력 폴더와 산출물의 충돌, 기존 정본의 정확한 절 링크를 보완했다. 부모는 Code 재사용·Memory 문맥 배치·ResourceSnapshotRef/TaskController 계약을 원본에서 확인했다. 새 설계와 연결 문서의 로컬 링크 26개, 20개 출처의 일대일 대응, 24개 예정 사례의 식별자, 기존 테스트 경로 및 새 REQ의 canonical 파싱을 검사했다. 제품 코드·설정은 바꾸지 않아 기존 제품 테스트를 반복하지 않았다.

이는 설계 검토 결과다. 런타임 안전성·성능·실제 모델 절감 효과·새 시나리오의 실행·원격 CI는 미검증이다. 출처 검토는 기존 문서의 고정 revision을 사용하고 S01/S14/S15의 관련 원문을 추가 확인했다. 이번에 20개 저장소의 모든 파일이나 최신 HEAD 전체를 다시 검사한 것은 아니다.

첫 P0/P1 구현의 선행 사용자 정책 질문은 없다. 기존 계약으로 진행할 수 있다. 유료 실행 예산, 실제 adapter 버전별 기능, 운영 보존 기간·RTO/RPO, 외부 발송 대상은 해당 단계 진입 전에 확인해야 한다. 값이 없다고 임의 기본값으로 자동 실행하지 않는다.

## 부록 A. 20개 출처와 적용의 전수 연결

각 행의 revision·license·직접 확인 파일은 [기존 출처 표](harness-engineering-adoption.md#출처별-검토-기록)가 정본이다. 이번 표는 같은 내용을 복제하지 않고 설계의 연결·제외·시기를 추가한다. 전체 저장소 모든 파일을 완벽히 검증했다는 주장이 아니다. 큐레이션 저장소는 실행 구현과 구분한다.

| ID / 저장소 | 채택할 원리·상태 | 보완·제외 이유 | 설계 / 시기 |
| --- | --- | --- | --- |
| S01 anthropics/skills | 선택 로딩 일부 구현; 명시 참고 자료·대조 실험 확장 | 자동 script 실행·무제한 참고 읽기 제외 | D02/D07, P2/P5 |
| S02 obra/superpowers | 검증 후 완료 원칙 유지; 근거 유효성 집행 설계 | 같은 입력의 유효한 검사를 무조건 반복하지 않음 | D03/D04, P3/P4 |
| S03 VoltAgent/awesome-agent-skills | 후보 발견 경로로 사용 | 전체 목록 설치·인기 기반 품질 보증 제외 | D08, P2 이후 필요시 |
| S04 agentsmd/agents.md | 지침의 위치·범위 정보 적용 | 모든 host가 같은 우선순위로 집행한다고 가정하지 않음 | D02, P2 |
| S05 coleam00/context-engineering-intro | 목표·자료·완료조건을 REQ에 결합 | PRP라는 두 번째 목표 정본 제외 | D10/D03, P1/P3 |
| S06 PatrickJS/awesome-cursorrules | 작업에 맞는 제한적 지침 선택 | 전역 규칙 합치기·Cursor glob 의미의 무조건 복제 제외 | D02/D09, P2/P5 |
| S07 disler/claude-code-hooks-mastery | 실행 수명별 관측 지점 참고 | root license 미확인 코드 복사, fail-open 강제선, 로그 전체 재작성 제외 | D04, P4 |
| S08 kenryu42/cc-safety-net | 하위 정책이 상위를 좁히는 방식 참고 | 원본 기본값 그대로 사용·shell 완전 분석 주장 제외 | D04, P4 |
| S09 VoltAgent/awesome-claude-code-subagents | 역할·산출물·입출력 계약 | 내장 모델/도구 선언을 사용자 설정·실제 권한으로 승격하지 않음 | D05, P5 |
| S10 wshobson/agents | 정적 검사와 과제 수행 검증 분리 | 역할 수 확대·LLM judge 단독 인증 제외 | D05/D07, P5 |
| S11 davila7/claude-code-templates | 출처·형식·호환성 별도 검사 | 자동 설치·구형 모델 목록·중복 scaffold 제외 | D08, P2 이후 필요시 |
| S12 anthropics/claude-quickstarts | 비코딩 과제, 읽기 상태·전달 cursor | prompt에 적힌 약속을 실제 전달 보장으로 주장하지 않음 | D03/D06/D10, P1/P4/P6 |
| S13 snarktank/ralph | 작은 작업·외부 진행 기록 | 권한 우회·무조건 반복·완료 문자열 판정 제외 | D05/D06, P3/P4 |
| S14 openai/symphony | 검증한 workflow snapshot·실행 대조 | tracker 종결만으로 자원 삭제, 지연만으로 재실행, 기존 승인 부활 제외 | D04/D06, P4/P6 |
| S15 harbor-framework/harbor | trial identity·원본 결과·usage 관측 | 관측 가능한 일부 값만 합산해 전체 비용처럼 보이지 않게 coverage 유지 | D07, P3/P5 |
| S16 harbor-framework/terminal-bench | 고정 과제·독립 검사·비코딩 적용 | 공개 정답·전체 corpus vendor, 검사기 자기 수정 제외 | D07, P5 |
| S17 QoderAI/better-harness | 비교 자격·다축 분석; 기록 비교 일부 구현 | missing→0 집계·조건 다른 승자 선정 제외 | D07, P3/P5 |
| S18 walkinglabs/learn-harness-engineering | 단계별 작은 실습·실패 이해 | mock 결과를 실제 retrieval/agent 성능으로 소개하지 않음 | D09, P1~P5 인수 사례 |
| S19 ai-boost/awesome-harness-engineering | 조사 경로·점검 기준 | 링크 유효성을 기능 품질로 취급하거나 새 의무를 무한 추가하지 않음 | D08/D09, P5 |
| S20 hesreallyhim/awesome-claude-code | 발견 경로만 사용 | CC BY-NC-ND 콘텐츠/목록 복제·변형 반입 제외 | D08, 후보별 별도 조사 |

S14의 [SPEC §7.4·8.5](https://github.com/openai/symphony/blob/be10a1b79df723d6d7612b5651c8522704dafb2e/SPEC.md)는 실행 대조와 지연 시 재시도를 설명한다. Ariadne는 대조 원리를 취하되 unknown 효과·사용자 stop을 보존하므로 재시도/정리 규칙을 그대로 가져오지 않는다. S15의 [usage 집계 구현](https://github.com/harbor-framework/harbor/blob/26f95e0ebd8c77011bbf4656f5c98af66ce55848/src/harbor/models/trial/result.py)은 관측된 값을 합산한다. Ariadne는 전체 비교에서는 누락이 있으면 null을 유지하는 기존 계약을 선택한다. 이것은 출처의 잘못을 단정하는 평가가 아니라 제품의 다른 보장 범위를 명시한 선택이다.

## 부록 B. 결정·시나리오·검증 연결

아래 HS-S는 모두 **예정 인수 사례**다. 기존 파일은 관련 회귀 기반이며 새 시나리오 통과를 의미하지 않는다. 기본 주체는 해당 프로젝트 자료에 권한이 있는 사용자와 그가 허용한 실행이다. tenant·외부 효과 사례는 해당 행의 범위를 별도로 따른다.

| 사례 / 결정·기존 정책 | 조건·행동 | 기대 결과·금지 결과 | 계층·현재 근거 / 추가할 검사 |
| --- | --- | --- | --- |
| HS-S01 / D02 | 명시 선택 skill의 bytes 변경 후 패킷 요청 | hash mismatch, 빈 stdout. 바뀐 본문 몰래 전송 금지 | 단위+CLI, `tests/skill-catalog.test.mjs`; 참고 자료 hash로 확장 |
| HS-S02 / D02·04 | skill/reference가 새 tool·모델·권한을 요구 | 참고 자료로만 처리, 권한 확대 없음 | 계약, 기존 skill 테스트; host guard 부정 입력 추가 |
| HS-S03 / D02·10 | 목표·AC·필수 참고 자료가 예산 초과 | 패킷 거절, 필수 의미 절삭·선택 누락 금지 | 단위+CLI, `tests/context-pack.test.mjs`; 직렬화 wrapper/참고 자료 추가 |
| HS-S04 / D10 | Git 없는 문서 폴더, 자료 없음 vs 읽기 권한 없음 | empty와 denied/unavailable 분리, 후자는 필수 AC 차단 | 단위+CLI, 기존 `tests/loop-contract.test.mjs`; nonGit manifest 신규 |
| HS-S05 / D03 | B 자료 수정, A/B 관련 주장·검사 존재 | 전체 manifest는 변경, 완전성이 확인된 A projection만 조건 대조 후 재사용. B와 최종 결합 검사는 갱신, 관계 불완전 시 전체 범위 | 통합, `tests/ontology.test.mjs`의 digest 기반; 영향 재검사 신규 |
| HS-S06 / D03·10 | 폴더 집계 검사 후 matching 파일 추가·삭제, 생성 보고서가 입력 glob과 겹침 | membership 변경 감지. 출력 분리/명시 규칙 전 snapshot 거절, 산출물 검사는 유지 | 통합, manifest 선택 규칙·집계 신규 |
| HS-S07 / D02·04 | 같은 범위 지침 충돌 또는 host 해석 미지원 | 충돌/지원 한계 표시, 임의 권한 완화 금지 | 계약, `tests/generators.test.mjs`, `tests/hooks.test.mjs`; host profile 신규 |
| HS-S08 / D03·04 / UES-COMPLETE-LATEST | 성공 검사 뒤 새 검사 시작·실패·unknown, 또는 P3에 과거 성공만 제출 | 현재 완료 불가, 과거 근거 보존. controller 없는 수동 이력은 completeness unknown으로 필수 검사 생략 금지 | 순수 fixture+통합, 기존 설계 §10.1; runtime 신규 |
| HS-S09 / D04 / UES-PACKET-BOUNDARY | AC·경로·오류·결과에 비밀, 다른 프로젝트 자료 포함 | 전체 패킷 scrub/반출 거절, 필수 의미 훼손 시 전송 안 함 | 계약, `tests/scrub.test.mjs`, `tests/loop-files.test.mjs`; 전체 envelope 신규 |
| HS-S10 / D04 / UES-RESUME | 승인 철회·만료 후 이전 정상 설정으로 재개 | 새 효과 거절, 등록/로그인만으로 승인 부활 금지 | 통합, runtime qualification 신규 |
| HS-S11 / D05 / UES-SLOTS | 부모·자식이 상한을 채운 상태에서 추가 child 요청 | 대기/거절, 같은 writer 중복 발급·내부 위임 우회 금지 | 통합, runtime 신규 |
| HS-S12 / D05·06 | 같은 실패에서 무관 파일만 수정하고 재시도 요청 | 관련 진전 없음. 승인된 transient 재조회와는 구분 | 단위+통합, `skills/route/SKILL.md` 절차; 판정기 신규 |
| HS-S13 / D06 / UES-OWNER-RECOVERY | crash 뒤 두 복구자가 동시에 시작 | 한 owner만 상태 변경, 기존 unknown 예약·claim 유지 | Podman 불필요 로컬 프로세스 통합, runtime 신규 |
| HS-S14 / D06 / UES-OWNER-FENCE | 사용자 stop 뒤 늦은 자식 결과·event 도착 | 감사 보존, stop 해제·자동 실행·현재 상태 덮기 금지 | 통합, runtime 신규 |
| HS-S15 / D06 | 외부 전달 접수 뒤 응답 유실, 같은 key 재요청 | unknown 대조, cursor 전진·이중 발송 금지; 다른 payload는 conflict | adapter 계약+통합, 실제 공급자 보장 별도 qualification |
| HS-S16 / D06 | 검증 artifact 저장 뒤 DB commit 전 crash | orphan≠pass, 기존 근거 보존, 소유 확인 후 정리 | 파일/DB 통합, runtime 신규 |
| HS-S17 / D07 | 실패·재시도·누락 usage·0성공 기록 | 전체 비용에 포함, 누락/정의불가 null, 승자 주장 금지 | 단위, `tests/evaluation-compare.test.mjs`; 관측 envelope 추가 |
| HS-S18 / D07 | parent/child 같은 요청 사용량 보고, 다른 계정에서 같은 request ID, 누적 meter 갱신 | 동일 provider/account/endpoint/request/meter만 중복 억제. 별개 요청·누적 갱신 구분, 포함 관계·충돌 미확인 unknown | 단위+adapter 계약, usage 수집 신규 |
| HS-S19 / D07 | 생성자가 정답 fixture 수정 또는 검사기 고장 | 독립 기준 유지, 고장을 pass로 바꾸지 않음 | 통합, `tests/evaluation.test.mjs` 제어군; 격리 qualification 별도 |
| HS-S20 / D03·07 | 보고서에 오래된 근거·정정·접근 실패·반대 자료 혼재 | 최신 정정/상충/미확인 표시, 링크 개수만으로 pass 금지 | 비코딩 fixture+사람 검토, 신규 |
| HS-S21 / D08 | 설치 후 사용자 수정·license 불명·update 중 crash | 사용자 파일 보존, 미검토 신규본 비활성, 원래 manifest 복구 | 통합, `tests/install-pointer.test.mjs`, `tests/adapt.test.mjs`; provenance/update 신규 |
| HS-S22 / D03·04 | 같은 query를 다른 tenant/철회된 actor가 요청 | owner의 현재 권한 판정, cached 결과 누출 금지 | owner API 계약+통합, memory 기존 org 검사 재사용 후 context 연동 신규 |
| HS-S23 / D06·08 | cleanup 중 공유 volume·사용중 process 발견 | 소유/종료 확인된 자원만 제거, 나머지 보존·blocker | 통합, `tests/command.test.mjs`; resource ledger 신규 |
| HS-S24 / D09·X01~05 | 제거/재사용/replay 실험이 필수 품질을 낮춤 | 실험안 폐기·기존 경로 유지. 전역 규칙 자동 변경·미측정 절감 주장 금지 | paired 실험+고정 반례, 신규; 유료 실행 별도 승인 |

설계 완료는 출처 20행의 분류, 책임·예외·호환 경계, 시나리오의 연결, 독립 검토를 충족했음을 뜻한다. 위 24개 사례의 구현·실행·CI·실서비스 통과를 뜻하지 않는다.
