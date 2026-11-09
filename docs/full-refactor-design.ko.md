# Ariadne 전체 리팩토링 설계

상태: 코드 대조와 독립 반례 검토를 마친 목표 설계. R 단계의 기존 기능 리팩토링은 구현과 로컬 검증을 마쳤다. H 단계의 공통 실행 하네스와 D 단계의 다중 인프라·서비스 분리는 후속 범위이며, 이 문서는 해당 기능의 구현·운영 완료를 선언하지 않는다.

## 1. 제품과 완료 목표

Ariadne는 사용자가 원하는 결과를 얻도록 목표, 문맥, 도구, 권한, 사용량과 검증을 연결하는 통합 에이전트 하네스다. 코딩은 지원 분야 중 하나다. 조사나 문서 작업에 Git 저장소, 코드 인덱스, 데이터베이스를 필수로 요구하지 않는다.

선택할 출발점은 **서비스 분리가 가능한 모듈형 모놀리스**다. MSA(독립 배포·확장하는 서비스 구조)로의 전환을 위해 데이터 소유권과 통신 계약을 지금부터 분리한다. 하나의 제품으로 설치하되 기능의 데이터와 규칙은 각 모듈이 소유한다. 모듈 내부는 DDD의 책임 경계와 클린 아키텍처의 의존 방향을 따른다. 별도 프로세스나 서비스를 모든 모듈에 강제하지 않는다.

리팩토링의 성공은 폴더 수가 아니라 다음 동작으로 판단한다.

- 온톨로지만 사용하는 사람은 memory/code 의존성이나 PostgreSQL 없이 사용한다.
- memory 저장 방식을 바꿔도 검색·압축·권한 규칙과 기존 외부 계약을 다시 구현하지 않는다.
- 코드 분석기를 추가할 때 분석기 계약과 등록 지점만 확장한다. 호출자가 저장 트랜잭션을 조립하지 않는다.
- 문맥 제공자가 없어도 필수 목표·제약·권한을 유지하며, 누락된 선택 기능을 명시한다.
- 새 기능이 다른 모듈의 내부 파일이나 DB에 접근하면 자동 검사가 실패한다.

제품 방향의 원본은 [product-direction.md](product-direction.md), 현재 파일 배치의 참고 문서는 [architecture.md](architecture.md)다. 이 문서는 목표 구조와 이행 기준을 소유한다.

후속 [Go + Rust 전환 설계](go-rust-runtime-design.ko.md)는 이 소유권을 유지하면서 Go 모듈 호스트·선택적 Rust 계산 엔진·호환 전환·빌드와 검증 순서를 정의한다. 언어 전환은 별도 목표이며 아래 R 단계의 완료나 H/D 단계의 구현 상태를 바꾸지 않는다.

## 2. 사용자가 보는 기능 선택

현재 제공되는 설치·검증 선택은 그대로 유지한다.

```sh
npm run setup -- --modules ontology
npm run verify -- --modules ontology
npm run setup -- --modules memory,ontology
node bin/Ariadne.mjs ontology inspect --file modules/ontology/example.json
```

`core`는 항상 포함한다. 선택은 해당 명령의 의존성 설치·빌드·검증 범위이며, 지속적인 활성화 설정이나 데이터 삭제 명령이 아니다. 기존 전체 설치 기본값도 유지한다.

| 사용 방식 | 필요한 구성 | 필요하지 않은 구성 |
| --- | --- | --- |
| 로컬 용어·관계 검토 | core + ontology | memory DB, code 인덱스, 모델 호출 |
| 장기 기억 저장·검색 | core + memory + 선택한 저장 어댑터 | code, ontology |
| 코드 영향 분석 | core + code + 로컬 SQLite | memory 서버, ontology |
| 근거를 활용한 조사·문서 작업 | core 문맥 기능 + 필요한 자료 제공자 | Git 저장소를 공통 전제조건으로 사용하지 않음 |
| 자동 작업 완주 | 향후 작업 실행 계약과 실제 실행기 | 이번 구조 변경만으로 제공된다고 표시하지 않음 |

사용자가 선택하는 설치 단위와 내부 책임 경계는 다르다. requirements/context/wiki 등을 모두 독립 npm 패키지로 만들 필요는 없다. 현재 공개 선택 목록은 `core,memory,code,ontology`로 유지한다. 별도 패키지 배포·지속 프로필·범용 플러그인 설치기는 이번 범위에 넣지 않는다.

## 3. 전체 책임 지도

DDD의 bounded context는 용어·규칙·데이터의 의미를 한 곳에서 결정하는 경계다. 아래 각 책임은 저장소를 공유하더라도 다른 책임의 내부 저장 구조를 직접 사용하지 않는다.

| 책임 | 소유하는 규칙과 데이터 | 공개 동작 | 하지 않는 일 |
| --- | --- | --- | --- |
| 제품 조립 | 모듈 선택, 명령 라우팅, 시작·종료·검증 순서 | setup/build/test/verify 및 기존 CLI 연결 | 검색·압축·코드 분석 규칙 구현 |
| 요구사항 | 목표·완료 조건·범위 해석, 실행 계약의 지문 | 계약 읽기·검증·변경 판정 | 실행 승인 생성, 도구 실행 |
| 문맥 | 필수 정보 보존, 선택 자료의 예산·출처·누락 표현 | 작업에 필요한 context pack 생성 | 모듈별 원본 저장소 직접 조회 |
| 규칙 통합 | 설치 파일 소유권, 마커, 백업·복원 계획 | install/adapt/remove | 사용자 파일의 광범위한 덮어쓰기 |
| Memory | 조직별 기억, 수집, 검색, 압축, 보관·복원, 인덱스 정합성 | 기존 CLI/HTTP/MCP와 애플리케이션 기능 | 다른 모듈 데이터의 원본 소유 |
| Code | 코드 사실, 그래프, 영향·계약 분석, 로컬 작업 기억 | 기존 CLI/MCP/UI와 분석 기능 | 일반 작업에 Git 사용 강제 |
| Ontology | 용어·동의어·명시적 관계, 출처, 검토 최신성 | inspect/search | 단어 일치를 사실 검증이나 답변 가능성으로 판정 |
| Wiki | 페이지 투영·링크 그래프·승격 규칙 | 기존 promote/index | 링크를 검토된 온톨로지 관계로 자동 승격 |
| 실행 연결 기반 | 기존 수동 handoff, HTTP 전송·응답 계약 | 기존 native/API 연결 | 미완료 dispatcher·자동 복구 활성화 |
| 평가 | 고정 평가 입력, 기준 실패·성공 판정, 비교 조건 | 기존 검증과 격리된 평가 | 실제 사용량을 추정값으로 대체 |

Memory의 조직 식별자를 일반 실행 권한으로 확대하지 않는다. Code의 `.parallax`에는 사용자 기억이 있으므로 전체를 캐시로 취급하지 않는다. Wiki의 투영, ontology 정의, memory 기록은 의미가 다르며 하나의 거대한 지식 테이블로 합치지 않는다.

### 통합 하네스의 추가 목표 책임

기존 기능을 계층별로 옮기는 작업만으로 제품 전체 설계가 완성되지는 않는다. 다음 책임은 목표 구조에 포함하지만 현재 dispatcher를 재개하거나 구현됐다고 간주하지 않는다. 별도 서비스 수가 아니라 **상태의 소유자**를 정의한다. 처음에는 같은 프로세스 안의 모듈로 구현할 수 있다.

| 목표 책임 | 소유 상태·주요 동작 | 다른 책임과의 경계 |
| --- | --- | --- |
| Task | 목표, 제약, acceptance criteria, task revision, 결과·검증 증거 연결 | Git 경로 없는 조사·문서 작업도 표현; memory goal-run 기록은 조회용 투영으로 취급 |
| Execution | attempt, step, operation, claim, checkpoint, 취소·결과 불명 상태 | 도구 실행을 소유하되 목표의 완료 판정과 조직 권한을 임의 변경하지 않음 |
| Authorization | 사용자 승인 출처·범위·revision·만료·철회와 동작별 인가 | 인증된 주체나 모델 판단을 실행 승인으로 간주하지 않음 |
| Usage | 작업별 예산 예약·소비·미확정 사용량 | 라우터·worker가 각자 전역 예산을 계산하지 않음 |
| Evidence | 원본 참조·revision·검증 조건·유효성·산출물 관계 | memory 검색 점수나 모델 설명을 검증 증거로 자동 승격하지 않음 |
| Tool/Executor 연결 | 기능 schema, 부작용·멱등성·취소 지원, 실행 결과 변환 | 도구 발견과 실행 권한을 분리; 공급자 SDK와 인증 세부는 어댑터에 한정 |

Task의 기록은 요구사항 모듈과 이어지는 단일 원본으로 설계한다. `REQ.status`의 네 상태를 실행 상태로 재사용하지 않고 기존 파일 계약을 입출력 어댑터로 보존한다. Memory의 goal-run과 향후 Task가 서로 같은 상태를 독립 수정하지 않도록 동기화 방향은 Task → memory 조회 투영으로 제한한다. 기존 memory API는 계속 유지하며 전환 대상은 새 공통 Task 경로다. Legacy goal-run과 Task 소유 투영은 provenance/namespace와 쓰기 경로를 구분한다. 기존 complete/record API로 canonical Task를 변경하거나 투영의 완료 표기를 Task 성공 증거로 사용할 수 없다. Task 소유 투영은 검증된 Task 이벤트만 갱신하고 legacy 쓰기는 그 영역에서 거절한다. 이 구분은 H 단계의 schema·권한 계약으로 구현한다.

Task·Run·Grant·Effect·검증 봉인과 dispatch의 원자적 판정은 기존 [실행 설계 §7–11](unified-execution-design.md#7-req실행-기록원본-근거의-소유권을-나눈다)를 단일 원본으로 계승한다. 그 문서의 `queued/running/awaiting_user/blocked/verifying/stopped/cancelled/completed` Task 상태와 Run의 `unknown`을 다른 enum으로 재정의하지 않는다. 기존 문서도 구현 전 계약이며 이 참조가 paused dispatcher를 활성화하지 않는다.

이번 전체 설계의 확장은 Git·worktree 중심 입력을 `ResourceSnapshotRef`라는 일반 자료 참조 계약으로 넓히는 것이다. 참조는 소유자·불투명 ID·revision·content digest·접근 범위·보존 수명을 표현한다. Git snapshot은 코드 어댑터 한 종류다. 문서 revision, 명시적으로 수집한 웹 자료와 파일 산출물도 같은 방식으로 Task 입력과 검증 범위에 연결한다. 자료 조회는 여전히 현재 권한을 확인한다.

- `EvidenceRef`는 자료 조회 참조이며 완료 인증이 아니다. 완료에는 criterion·task revision·검증 plan·입력/환경 scope·실제 check attempt·산출물·유효성이 연결된 `VerificationReceipt`가 필요하다.
- 기존 판정처럼 각 필수 check의 **가장 최근 시작 시도**를 선택한다. 새 검사가 pending/failed/unknown인데 과거 통과만 골라 완료하지 않는다.
- Task의 과거 `completed`와 현재 `receiptValid`를 구분한다. 재검증 실패·자료 변경은 receipt의 현재 유효성을 바꾸지만 종결된 Task를 자동으로 실행 대기열에 돌려놓지 않는다.
- 자료·계약·환경의 같은 revision을 검증 시작과 완료 반영 시 다시 대조한다. 관측할 수 없는 입력 범위는 동등하다고 가정하지 않는다.
- Task revision, 실행 generation, policy revision, selection revision과 dispatch 슬롯·자원 claim·예산 예약은 하나의 권위 있는 로컬 원자적 판정 경계에 둔다. 이 원자적 결정을 소유하는 애플리케이션 구성요소를 TaskController로 지정한다. TaskController의 control store가 admission·예약·효과 의도·완료 봉인을 함께 commit한다. Usage·Authorization·Evidence는 정책과 기록의 논리적 책임이며 이 결정에 필요한 권위 상태를 각각 독립 서비스의 transaction으로 찢지 않는다. dispatch 시 각각 원격 조회한 결과를 모아 원자적 승인이라고 부르지 않는다. 원격 IdP 검증은 이 transaction 밖의 입력이며 실제 효과 직전 현재 grant/stop fence 확인은 별도 필수 경계다.
- 원격 resource worker는 발행된 실행 의도를 검증하고 소유자에게 현재 허가를 확인한다. 제어면과 단절됐을 때 확인 없이 새 외부 효과를 시작하지 않는다. 이미 접수된 효과의 unknown 처리와 종료 확인은 기존 실행 계약을 따른다.

Task의 `taskRevision`은 목표·완료 계약 변경, `stateVersion`은 상태 CAS, `generation`은 실행 소유권 교체, `policyRevision`은 권한 변경을 나타낸다. heartbeat나 상태 갱신만으로 taskRevision을 올리지 않는다. 호출자가 이 값을 임의 선택하지 못하게 소유 store가 부여한다.

Evidence의 원본 자료와 검증 결과는 서로 다르다. TaskController는 완료 transaction 안에서 현재 plan, 최신 check attempt, controller가 관측한 input revision, 증거 무효화 version, 실행·권한·정리 blocker를 검사한다. 완료와 무효화가 경합하면 같은 control store의 순서로 결정한다. 외부 원본이 transaction 직후 바뀔 가능성을 없앴다고 주장하지 않는다. Receipt는 **관측한 immutable snapshot에 대한 완료**를 증명하며, 현재 원본과의 일치 여부는 다시 확인한 시각·revision과 `receiptValid`로 별도 표시한다. 외부 revision을 신뢰성 있게 확인할 수 없으면 최신성은 unknown이다. 변경 이벤트는 최신성 확인의 가속 수단이며 유일한 안전 근거가 아니다.

승인 범위는 `{principal, taskId, taskRevision, action, resourceScope, executorRef, destinationRef, accountRef, egressScope, approvalSourceRef, expiresAt, grantRevision, policyRevision}`처럼 검증 가능한 서버 소유 기록으로 표현한다. 메시지의 조직 ID나 승인 설명 문자열 자체는 증거가 아니다. 실행 직전에 현재 권한을 재확인하며, 실행 중 철회는 가능한 취소와 이후 효과 제한으로 처리한다. 이미 완료된 외부 효과가 취소로 되돌려진다고 약속하지 않는다.

Usage는 병렬 실행 전에 보수적 상한을 원자적으로 예약하고, 호출 후 공급자 측정값으로 정산한다. 응답을 잃어 사용량을 모르면 예약을 임의 환급하지 않고 미확정으로 유지한다. 절대적인 상한이 필요한 작업에서 공급자가 상한을 보장하지 못하면 실행을 거절하거나 별도 명시 승인을 요구한다. 취소·실패·재시도·라우팅·검토 호출도 동일 task에 귀속하며 구독 잔여량으로 환산하지 않는다. Usage observation은 공급자·요청 ID·meter 정의·관측 범위·원본 계측 참조를 보존한다. cached/reasoning 등이 input/output의 부분집합인지 별도 항목인지 명시해 이중 합산을 막는다. 현재 requestCompletion은 input/output 합계만 정규화하므로 세부 사용량을 이미 관측한다고 표시하지 않는다.

도구 내부 결과는 `completed`, `rejected`, `failed`, `unknown`을 구분하고 operation ID, 산출물 참조, 복구 단서와 재시도 가능 조건을 포함한다. transport의 HTTP 200과 업무 성공은 별개다. 기존 HTTP/MCP 응답 형식은 호환 어댑터에서 유지한다. 모델이 제시한 후속 작업은 제안이며 새 실행 권한이 아니다.

Memory에 넣는 자료는 사용자 사실·검토된 근거·모델 추론을 구분한다. 사용자 정정과 원본 변경으로 오래된 주장을 무효화하고, 요약이 원본보다 강한 사실로 승격되지 않도록 출처를 유지한다. 검색된 문서의 지시·도구 출력·과거 기록은 현재 사용자 권한이나 상위 실행 규칙을 바꾸지 못한다. `kind=fact` 같은 내용 분류와 검증 여부는 별도다. 신규 admission 계약에는 origin(사용자/도구/모델), sourceRef·revision, 검토 주체, 검증 상태, supersedes 관계와 보존 범위를 둔다. 기존 provenance 없는 기록은 `unknown`으로 유지하며 자동 인증하지 않는다. 검토·정정 권한은 서버가 판정하고 모델의 분류 제안은 기록 승인이나 검증으로 취급하지 않는다.

## 4. 모듈 내부 구조

큰 모듈은 다음 구조를 사용한다. 작은 모듈은 같은 책임을 `domain.mjs`, `application.mjs`, `files.mjs`, `cli.mjs`로 표현해도 된다. 한 줄 전달 함수만 늘리기 위한 디렉터리는 만들지 않는다.

```text
packages/memory/src/ 또는 packages/code/src/
  domain/           모델, 불변 조건, 순수 정책
  application/      유스케이스, 의미 있는 입출력 계약과 포트
  infrastructure/   DB, 파일, Git, 모델, 프로세스 어댑터
  interfaces/       CLI, HTTP, MCP, UI 입력·출력 변환
  composition/      실제 어댑터 선택과 객체 수명 관리
  기존 경로          호환성에 필요한 재노출만 유지
```

의존 규칙은 다음과 같다.

| 계층 | 허용 의존성 | 금지 사항 |
| --- | --- | --- |
| domain | 같은 경계의 모델·정책, 명시적으로 허용한 순수 공통 함수 | DB·파일·HTTP·환경변수·CLI·다른 모듈 내부 |
| application | domain, 자신이 요구하는 의미 중심 포트 | 구체 DB 클라이언트, SQL 문자열, 프레임워크 요청 객체 |
| infrastructure | 안쪽의 포트·타입, 외부 라이브러리 | 다른 모듈 저장소에 쓰기, 유스케이스 순서의 별도 구현 |
| interfaces | application, 외부 프로토콜 스키마 | 직접 SQL·업무 트랜잭션 조립 |
| composition | 해당 기능을 구성하는 실제 구현 | 도메인 정책의 두 번째 구현 |
| compatibility | 정식 공개 진입점으로 재노출 | 안쪽 계층에서 역으로 import |

환경변수와 기본 경로는 composition/어댑터에서 읽는다. 입력 형식은 CLI/HTTP/MCP 경계에서 검증하고, 조직 권한과 도메인 불변 조건은 실제 동작 경계에서도 유지한다. 계층을 옮긴다는 이유로 중복처럼 보이는 별도 책임의 검사를 제거하지 않는다.

모듈 간에는 기존 공개 진입점이나 명시한 애플리케이션 계약만 사용한다. 첫 단계는 정적 조립이다. 전역 서비스 로케이터·자동 플러그인 탐색은 도입하지 않는다. 현재 단계에서 브로커를 필수 설치하지 않되, 비동기 연결은 아래의 명시적 발행·소비 계약과 구성 경계를 따른다. 공통 코드에는 제품 전체가 실제로 공유하는 작은 값과 규칙만 둔다.

## 5. 호출 계약 초안

아래는 새 SDK나 이미 존재하는 export가 아니라, 내부 계약을 검토하기 위한 의사 타입이다. 구현 시 기존 타입을 우선 재사용한다.

```ts
// 호출자가 원하는 결과부터 정의한다.
memory.retrieve(query, authorizedScope)
code.analyze(changeSelection)
ontology.inspect(definitionRef)
context.build(requirement, selectedSources, budget)

interface ContextSource {
  // authorized request만 전달하며 제공자도 자신의 접근 권한을 검사한다.
  collect(request: ContextRequest): Promise<SourceResult>
}

type SourceResult =
  | { kind: 'available'; evidence: EvidenceRef[]; content: ContextItem[] }
  | { kind: 'unavailable'; reason: string }

interface EvidenceRef {
  owner: string
  id: string
  revision: string // 공급자가 정의한 변경 판정값; 최신성의 영구 보증이 아님
}

// 모듈 밖으로 노출하는 업무 계약. 내부 write scope와 별개다.
interface MemoryCommands {
  write(command: MemoryWriteCommand): Promise<MemoryWriteResult>
}
```

공통 `query(sql)` 포트나 범용 `Repository<T>`로 저장 기술을 안쪽에 노출하지 않는다. `write`는 memory 도메인이 정의한 명령만 받는다. 현재 내부 `MemoryWriteCoordinator`의 record/archive/create/restore callback과 예약 세션은 모듈 안에 유지한다. 내부 `MemoryWriteScope`를 네트워크 DTO나 범용 원격 transaction으로 변환하지 않는다. 세부 포트는 기존 유스케이스를 대조해 정하며 모든 기능을 하나의 메서드에 몰아넣지 않는다.

문맥 공급자 합성은 기존 context builder 계약을 보존하면서 진행한다. 제공자 실패를 빈 성공으로 변환하지 않는다. 필수 자료가 없으면 실패 또는 불완전 결과를 명시하고, 선택 자료를 제외했다면 이유와 출처를 남긴다. 권한·완료 조건은 예산 초과를 이유로 잘라내지 않는다.

## 6. 데이터와 실패 경계

| 영역 | 반드시 보존할 조건 |
| --- | --- |
| Memory 쓰기 | 예약한 PostgreSQL 세션에서 락·repository·pgvector 작업 수명을 유지한다. 만료·실패 세션으로 계속 진행하지 않는다. 락 순서와 실패 복구 계약을 보존한다. |
| Code 쓰기 | facts/DAG/head/vector 게시와 savepoint의 원자성을 유지한다. SQLite 트랜잭션 콜백은 동기식으로 유지하고 모델 I/O는 밖에서 수행한다. |
| Code 읽기 | 일관된 읽기 snapshot과 해제 후 최신 run 재검사를 보존한다. |
| 파일 변경 | 보호 경로·symlink·secret·mode·기존 내용 비교를 유지한다. 임의 외부 writer에 대한 OS sandbox라고 주장하지 않는다. |
| 설치·제거 | manifest에 기록한 소유 파일만 제거하고 사용자 파일과 기존 백업을 보존한다. 설치된 실행 경로의 의존 파일도 함께 포함한다. |
| 모듈 간 동작 | 전역 트랜잭션을 가정하지 않는다. 원본 변경은 소유 모듈에 요청하고 파생 결과의 갱신 실패를 별도로 드러낸다. |
| API 호환성 | CLI 인자·cwd·종료 코드·signal, HTTP 인증·오류, MCP 도구·리소스·DTO, 기존 export를 유지한다. |

이번 리팩토링은 저장 스키마 변경이나 사용자 데이터 이동을 요구하지 않는다. 모듈 선택 해제는 서비스 데이터·권한·credential 삭제를 뜻하지 않는다.

## 7. 토큰 사용을 줄이는 구조

비용 목표는 검증된 결과 하나를 얻는 데 든 전체 사용량이다. 구조 변경만으로 절감 효과를 주장하지 않는다.

- 문맥은 필요한 제공자에만 요청한다. memory-only 작업 때문에 code 인덱스를 만들지 않는다.
- 근거 재사용은 입력·범위·버전·환경·권한이 동일한 경우로 제한한다. 내용이 같아도 권한이 바뀌면 다시 판정한다.
- 출처가 바뀌면 해당 근거에 의존하는 결과부터 무효화한다. 의존 관계를 확인하지 못하면 보수적으로 재검증한다.
- 파싱·검증·선택·해시 계산은 결정적 코드로 처리한다. 모든 단계에 모델 호출을 넣지 않는다.
- 관측 가능한 공급자 사용량과 재시도·라우팅·검토 비용을 함께 집계한다. 관측 불가능한 값은 `unknown`으로 둔다.

새 캐시·계측 저장소·자율 라우터는 이 문서만으로 구현하지 않는다. 먼저 기존 문맥/평가 기능의 소유권을 정리하고, 실제 작업 비교가 가능한 별도 기능 단위로 추가한다.

## 8. 대안과 선택 이유

| 대안 | 장점 | 부담과 결정 |
| --- | --- | --- |
| **기능 경계별 모듈 + 내부 계층** | 호출자가 기억 저장이나 코드 분석 한 동작을 요청하면 내부 정합성을 모듈이 책임짐 | 일부 모듈이 커도 데이터 원자성을 보존하므로 채택 |
| 기능마다 독립 서비스·DB·배포 | 프로세스와 확장을 독립 운영 가능 | 사용자가 여러 서비스를 조합하고 분산 실패를 처리해야 함. 초기 필수 구성으로는 보류하되, 아래 서비스 분리 기준과 계약을 마련 |
| 프로젝트 전체를 domain/application/infrastructure 세 폴더로 통합 | 초기 파일 이동이 단순함 | memory/code/ontology 소유권이 흐려지고 공통 계층이 커지므로 제외 |

기존 검토에서 선택한 모듈 경계와 저장 정합성 보존 결정을 유지한다. 별도 서비스 분리는 실제 운영·확장 요구가 생긴 모듈에만 적용한다. 과거 경로 호환성을 유지하는 비용은 수용하되, 내부 신규 호출은 정식 경로 한 곳만 사용한다.

## 9. MSA와 복수 인프라 확장 설계

### 배포 단위와 도메인 경계

단일 설치, 일부 원격 서비스, 전체 분산 배포가 같은 도메인 규칙을 사용하도록 설계한다. 로컬 어댑터와 원격 어댑터는 같은 업무 계약을 구현하되 네트워크 지연·부분 실패까지 동일한 것처럼 숨기지 않는다. 원격 호출에는 deadline, 취소, 결과 불명, 재시도 가능 여부를 표현한다. 기존 공개 API는 보존하고 새로운 서비스 간 계약은 별도 버전으로 관리한다.

서비스 분리 후보는 memory 검색·수집, code 분석 worker, ontology 조회 등이다. 이는 배포 후보이며 즉시 분리할 목록은 아니다. 같은 락·원자적 갱신에 참여하는 memory 쓰기와 인덱스, code 게시 작업은 해당 정합성 경계 안에 둔다. 분리하려면 기존 보장 변경을 명시하고 별도 이행 설계를 승인받아야 한다.

분리 기준은 측정한 처리량·지연, 장애 격리, 독립 배포 주기, 데이터 접근 통제다. 단순히 파일이 크다는 이유로 서비스를 나누지 않는다. 서비스 간 긴 동기 호출 사슬을 피하고 결과를 묶어 조회하거나 필요한 투영을 사용한다.

### 하나를 고르는 설정이 아닌 여러 인스턴스의 조합

**DB·캐시·인증 공급자·브로커를 전역 단일 provider로 선택하지 않는다.** 이름 있는 인프라 인스턴스를 정의하고 각 모듈의 역할에 명시적으로 연결한다. 구성의 원본은 배포 단위의 composition이 소유하고 도메인 코드가 resource 이름으로 임의 lookup하지 않는다. PostgreSQL 여러 개, 관계형 DB와 벡터 저장소, Kafka와 RabbitMQ의 동시 사용을 허용하는 구성이 목표다.

다음은 구성 의도를 설명하는 예시이며 현재 지원되는 설정 파일 형식이나 구현 완료 목록이 아니다. 주소·credential은 생략한다.

```yaml
resources:
  memory-primary: { kind: database, adapter: postgres }
  memory-vectors: { kind: vector-index, adapter: qdrant }
  code-local: { kind: database, adapter: sqlite }
  retrieval-cache: { kind: cache, adapter: redis }
  domain-events: { kind: event-stream, adapter: kafka }
  ingest-tasks: { kind: work-queue, adapter: rabbitmq }
  user-identity: { kind: identity, adapter: oidc }
bindings:
  memory:
    records: memory-primary
    vectors: memory-vectors
    retrievalCache: retrieval-cache
    events: domain-events
    ingestQueue: ingest-tasks
  code:
    facts: code-local
    events: domain-events
  identity:
    users: user-identity
```

이 구성 자체가 모든 조합의 호환성을 보장하지는 않는다. composition은 필수 기능, 계약 버전, 트랜잭션·내구성·순서 조건을 시작 전에 검사하고 충족하지 않는 조합을 거절한다. 전역 singleton이나 환경변수 하나로 연결을 덮어쓰지 않는다. 설치 모듈 선택과 런타임 인프라 binding은 별개다. 기존 설정은 기본 binding으로 변환해 호환성을 유지하는 것을 목표로 한다.

Binding은 역할·adapter ID·계약 버전·필요 capability·consistency group·secret 참조로 검증한다. capability는 사용자 YAML의 자기 선언을 신뢰하지 않고 버전이 고정된 adapter descriptor와 계약 테스트로 판정한다. 지원되지 않는 필수 기능을 자동 대체하지 않는다.

- 로컬 transaction을 공유해야 하는 역할은 같은 데이터베이스와 transaction manager에 속해야 한다. Memory의 세션 락·pgvector 계약은 여기서 더 나아가 같은 예약 연결과 실제 작업 수명(UoW)을 공유해야 한다. 같은 pool의 서로 다른 연결은 충분하지 않다. 같은 서버나 같은 문자열 resource ID라는 이유만으로 허용하지 않는다.
- 별도 vector 서버와 원본 DB를 연결하면 같은 transaction 보장 대신 검증된 indexing intent·재시도·조회 최신성 계약을 적용한다. 두 보장을 혼용하지 않는다.
- resource별 연결 수·timeout·namespace·조직 routing·close 소유자를 명시한다. 공유 client는 수명을 참조하는 모듈이 모두 종료된 후 한 번 닫는다.
- 부분 초기화 실패 시 열린 자원만 역순으로 닫고 성공한 것처럼 준비 상태를 내보내지 않는다. migration은 데이터 소유 모듈의 지정된 배포 작업이 수행하며 요청 처리마다 실행하지 않는다. 현행 로컬 bootstrap migration 경로는 호환성을 확인한 뒤 이행한다.
- 실행 중 binding 자동 변경은 초기 범위에서 제외한다. 재시작·drain을 통해 적용하고 진행 중 operation에는 원래의 binding revision을 유지한다.

| 인프라 | 안쪽에서 요구할 계약 | 어댑터가 책임질 사항 |
| --- | --- | --- |
| DB | 기억 저장, 분석 결과 게시 등 의미 있는 repository·write scope | 연결 pool, transaction, query, migration, timeout |
| 벡터·검색 | 조직 범위가 있는 색인·검색, 버전·최신성 | 공급자 필터, 인덱스 형식, 동기화·재구축 |
| 인증 | 검증된 주체·조직·권한 범위, 별도의 인가 판정 | token/session 검증, issuer·audience·만료, 키 갱신 |
| 캐시 | 허용된 결과의 제한된 재사용·무효화 | TTL, 저장 제한, namespace, eviction, 장애 처리 |
| 이벤트 스트림 | 사실 발행, 소비 위치, 재처리·버전 | Kafka 등의 partition·offset·보존·소비자 구현 |
| 작업 큐 | 작업 요청, claim/ack, 재시도·격리 | RabbitMQ 등의 routing·ack·재전달·consumer 구현 |

### DB: 여러 저장소와 하나의 원본 소유자

모듈마다 DB와 schema를 소유하며 다른 서비스는 공개 계약을 통해 접근한다. 초기에는 물리 DB 서버를 공유할 수 있지만 테이블 소유권과 접근 권한은 분리한다. cross-service join과 다른 모듈 테이블 쓰기를 금지한다. 각 저장소의 migration 버전·실행 주체·백업·복원 단위가 명확해야 한다.

같은 모듈도 원본 DB, 검색 인덱스, 읽기 replica를 함께 사용할 수 있다. 각 데이터 종류의 원본은 하나로 지정한다. 파생 저장소에는 원본 revision과 반영 상태를 남기고 지연 허용 여부를 호출 계약에 표현한다. replica에서 즉시 read-after-write가 보장된다고 가정하지 않는다.

여러 DB에 걸친 원자적 commit을 가정하지 않는다. 원본 쓰기와 전송 의도를 같은 로컬 transaction에 기록하는 outbox, 중복 소비를 막는 inbox, 재처리·재조정을 필요 경계에 적용한다. 외부 저장소 갱신은 실패·지연 상태를 노출한다. 기존 outbox가 있으면 업무·재시도·완료 조건이 같은지 확인한 뒤 재사용한다. 현 memory ingest_jobs의 visibility timeout 재시도는 인덱싱 전용이며 범용 Execution의 claim/fencing ledger를 대신하지 않는다. 모든 DB를 범용 CRUD 포트로 통일하지 않고 기능별 어댑터 적합성 테스트를 둔다.

확장은 먼저 query·index·pool 한도와 병목을 측정한 뒤 읽기 replica, partition 또는 shard를 선택한다. 조직별 shard routing을 도입하면 routing 정보의 소유자·이동 절차·교차 shard 제약을 별도 설계한다. 연결 pool은 인스턴스별·프로세스별 한도를 두고 전체 replica 수를 고려해 DB 연결 예산을 제한한다.

### 인증·인가: 여러 공급자와 서비스 간 신뢰

인증 공급자는 조직 또는 명시된 trust realm에 연결한다. 외부 계정은 issuer와 subject를 함께 식별하고, 같은 이메일을 자동으로 동일 사용자로 합치지 않는다. 요청자가 임의로 공급자를 선택해 검증을 우회할 수 없도록 신뢰 설정을 서버가 소유한다.

인증은 주체 확인, 인가는 동작 허용 여부다. gateway에서 확인했더라도 각 서비스는 자신이 소유한 자원과 조직에 대한 권한을 검사한다. 내부 호출도 신뢰된 인증 경로를 사용하고 사용자 token을 무조건 전달하지 않는다. 위임 범위·audience·유효기간을 제한하고 서비스 주체와 사용자 주체를 구분한다.

credential·키는 secret 참조로 주입하며 도메인 모델·설정 예제·로그·이벤트에 원문을 넣지 않는다. 권한 취소의 반영 지연과 캐시 정책을 명시한다. 인증 실패나 정책 조회 장애를 허용으로 바꾸지 않는다. 로컬 단독 실행과 원격 다중 사용자 운영의 신뢰 모델은 각각 명시한다.

### 캐시: 선택 가능한 가속 계층

프로세스 내 캐시와 공유 캐시를 필요 기능에 함께 연결할 수 있다. 캐시는 원본·인가 시스템·영구 중복 방지 기록을 대체하지 않는다. 키에는 조직·접근 범위·자료 revision·검색/모델 설정 등 결과에 영향을 주는 요소를 포함한다. 개인화 결과의 사용자 간 재사용은 명시적인 안전 계약 없이는 금지한다.

쓰기 후 무효화, version 기반 key, TTL을 조합하되 TTL만으로 최신성이나 권한 안전을 보장하지 않는다. 동시 cache miss는 요청 합치기와 부하 제한으로 제어한다. 조회 캐시 장애 시 원본으로 우회할 수 있지만 원본 보호 한도를 넘으면 제한된 오류를 반환한다. 인증·보안용 상태는 일반 조회 캐시와 장애 정책을 분리한다. 캐시를 전부 잃어도 원본 데이터는 유지돼야 한다.

### Kafka·RabbitMQ: 함께 사용하되 의미를 구분

이벤트 스트림과 작업 큐는 별도 포트다. Kafka와 RabbitMQ를 하나의 `send(any)` 인터페이스로 뭉개지 않는다. 실제 브로커 기능과 설정이 계약을 만족하면 다른 역할에도 연결할 수 있지만, 어댑터 이름만 보고 내구성·순서·재처리 보장을 추정하지 않는다.

- 이벤트는 이미 일어난 사실이며 발행 후 임의로 바꾸지 않는다. `event_id`, 종류·schema version, 소유 모듈, aggregate id/revision, 발생 시각, correlation/causation을 정의한다. 민감 payload는 최소화하고 조직 정보는 검증된 맥락에서만 생성한다.
- 작업 요청에는 `operation_id`, 요청 종류·버전, idempotency key, deadline, 권한 재검사에 필요한 안전한 참조를 둔다. 처리 시작 전 현재 권한과 취소 상태를 확인한다.
- 중복 전달을 기본 실패 모델에 포함한다. 소비자의 효과와 처리 기록을 가능한 같은 로컬 transaction에 저장하고 성공 후 ack한다. 외부 효과가 있으면 공급자의 멱등 지원이나 상태 조회로 결과 불명을 조정하며 무조건 재실행하지 않는다.
- 병렬 worker는 operation의 원자적 claim과 진행 중 상태를 통해 실행 소유권을 확인한다. claim lease 만료·상실 후 늦게 끝난 worker의 결과 게시를 fencing token 또는 동등한 비교 갱신으로 거절한다. 이 장치만으로 외부 효과 중복을 막을 수는 없으므로 외부 시스템에도 안정된 idempotency key를 전달하거나 결과를 조정한다. 이를 지원하지 않는 외부 효과의 결과 불명은 자동 재실행하지 않는다. 중복 방지 key는 조직·동작 범위로 격리하고 같은 key의 다른 payload를 거절하며, 기록 보존 기간을 허용 재시도·재전달 기간과 맞춘다.
- 순서는 aggregate 또는 작업 key 범위로 정의한다. 여러 partition·queue·브로커 사이의 전역 순서와 exactly-once를 약속하지 않는다. 구버전·역순 메시지를 revision으로 판정한다. 전체 snapshot 이벤트와 delta 이벤트를 구분한다. delta에서 예상 revision을 건너뛴 메시지는 바로 적용하거나 이전 이벤트를 버리지 않고, 제한된 대기·누락 이벤트 재생 또는 원본 snapshot 재구축으로 연속성을 회복한다. 재구축 중 처리 위치와 후속 이벤트의 적용 경계도 소유 모듈이 관리한다. 누락이 남은 투영은 최신으로 표시하지 않고 지연·불완전 상태를 반환한다.
- 재시도 횟수·총 시간·backoff를 제한하고 poison message를 격리한다. 격리 메시지는 원인 수정·권한 확인 후 감사 가능한 절차로 재처리한다.
- queue 적체·consumer lag·outbox age·실패율을 관측한다. bounded concurrency와 backpressure로 DB·모델 예산을 보호한다.

예를 들어 memory 원본 commit과 outbox를 함께 기록하고, relay가 Kafka에 변경 사실을 발행할 수 있다. 작업이 필요하면 소비자가 자기 DB의 inbox·작업 의도를 원자적으로 기록하고 별도 relay가 RabbitMQ로 보낸다. 두 브로커로 직접 연속 전송한 뒤 성공으로 처리하지 않는다. bridge가 필요하면 dedup·loop 방지·schema 변환·재처리 소유자를 명시한다. 중계 경로가 필요 없는 기능에는 이 구성을 추가하지 않는다.

### 네트워크·운영·서비스 추출 기준

네트워크 DTO는 직렬화 가능한 값과 불투명 ID로 정의한다. DB handle·클래스 instance·로컬 절대 경로를 원격 계약으로 넘기지 않는다. 로컬 code 분석이 원격 worker로 이동할 때에는 명시적으로 허용한 자료의 snapshot/revision과 접근 범위를 전달하는 별도 입력 어댑터가 필요하다.

동기 호출에는 전체 deadline을 전파하고, 재시도는 멱등성과 남은 시간·사용량 예산 안에서 한 책임자가 관리한다. timeout은 서버 작업 취소나 미실행의 증거가 아니다. 변경 요청에는 operation 조회와 결과 불명 상태를 두고 중복 실행을 방지한다. 오류 계약은 거절·충돌·일시 장애·결과 불명을 구분한다.

계약 변경은 추가 필드부터 도입하고 구·신 소비자와 생산자의 혼합 버전을 검증한다. 파괴적 변경은 병행 버전과 종료 절차를 둔다. DB schema도 확장→전환→제거 순서로 배포 호환성을 유지한다.

각 서비스는 readiness와 liveness, graceful shutdown, 진행 중 작업 drain, trace/correlation, 지연·실패·처리량·자원 사용량을 제공한다. token/내용 원문을 관측 데이터에 무차별 기록하지 않는다. worker 수는 queue 깊이만이 아니라 처리 지연·DB 한도·공급자 quota·예산을 함께 고려해 늘린다. 무상태 API와 상태 소유 worker/저장소의 확장 전략을 구분한다.

서비스 추출은 공개 계약 고정 → 원격 어댑터 및 계약 테스트 → 단일 writer를 유지한 데이터 이행 → 제한된 traffic 전환 → 지표 확인 순서다. 읽기 shadow는 가능하지만 쓰기를 양쪽에서 독립 수행하지 않는다. 데이터 이동 전 백업·복원과 writer 차단·증분 동기화·cutover를 정한다. 원본 데이터뿐 아니라 operation/idempotency/result/inbox/outbox/consumer checkpoint와 routing epoch의 이행 단위를 정하고, 이전 라우팅으로 도착한 요청도 같은 중복 방지 기록을 조회하거나 명시적으로 거절하도록 한다. 이전 writer를 fencing한 뒤 새 writer를 열며, 지연 메시지가 이동 전 상태에 새 효과를 만들지 못하게 한다. 전환 후 새 쓰기가 생기면 역동기화 없이 옛 저장소로 되돌리지 않는다. 기존 정합성 보장이 유지될 때만 다음 단계로 진행한다.

이번 설계는 특정 브로커·DB·IdP 설치나 MSA 배포를 수행하지 않는다. 현재 리팩토링의 산출물은 교체 가능한 계약·조립 경계와 계약 검증 기준이다. 실제 다중 인프라 지원은 선택한 어댑터별 구현·장애 검증을 통과한 조합만 지원 목록에 올린다.

## 10. 전체 이행 순서

완료 표시는 세 범위로 분리한다. R은 기존 기능 전체 리팩토링, H는 통합 하네스의 공통 작업 계약과 한 작업의 실행, D는 복수 인프라·서비스 배포다. **R 완료를 H/D 완료로 보고하지 않는다.** 아래 0–7 단계는 R의 이행 순서다. H/D의 계약은 지금 설계하지만 runtime 구현은 각각 별도 REQ와 검증을 거친다.

| 범위 | 구현 단위 | 필수 인수 사례 |
| --- | --- | --- |
| R: 구조 변경 | 기존 모든 기능의 소유권·계층·호환성 정리 | 기존 데이터·외부 계약을 유지하고 선택 모듈 설치·기존 전체 gate 통과 |
| H: 공통 하네스 | Task/Execution/Authorization/Usage/Evidence와 하나의 실행기 | Git 없이 자료→보고서 작업; 목표 변경 후 증거 무효화; 중단·재개·권한 철회; 병렬 예산 초과 거절 |
| D1: 복수 인프라 | 검증된 named binding과 실제 필요한 adapter | 두 memory 인스턴스의 데이터·pool·종료 격리; 지원하지 않는 transaction 조합 시작 거절 |
| D2: 서비스 추출 | 필요한 모듈 하나를 원격으로 전환 | 계약 혼합 버전·timeout 결과 불명·단일 writer cutover·복구 검증 |
| D3: 복수 브로커 | 실제 요구에 맞는 stream/queue와 bridge | Kafka+RabbitMQ 동시 구동, 중복·역순·분리 장애·재처리 검증 |

H/D에서 요구하는 schema 변경과 새 상태 저장은 R의 무스키마변경 원칙을 소급해서 깨뜨리지 않는다. R 이후 migration과 호환성 계획을 별도로 둔다. DB·브로커 제품을 모두 미리 구현하지 않고, 요구한 조합을 추가할 때 같은 적합성 기준으로 확장한다.


| 단계 | 변경 범위 | 종료 기준 |
| --- | --- | --- |
| 0. 계약 고정 | CLI/API/MCP/export/데이터/설치 계약, 현재 dirty 파일과 기준 commit | 변경 전 동작과 소유 파일 목록 확보 |
| 1. 경계 검사 | root 및 각 package의 ownership map, import/의존성 검사 | 미등록 파일·역방향 의존·다른 모듈 내부 접근을 의도적으로 넣으면 실패 |
| 2. core 정리 | requirements/context/integration/wiki/실행 연결/평가/launcher/hooks | 현재 명령과 설치 후 context 실행, 복원·소유권 검증 통과 |
| 3. memory 정리 | 수집·검색·압축·복원·index/작업 queue/HTTP/MCP/운영 스크립트 | 정책·유스케이스·I/O 분리 및 실제 DB 정합성 통과 |
| 4. code 정리 | indexing/analysis/graph/contracts/workspace/local facts/UI/MCP/도구·bench | snapshot·게시 원자성·schema·export·분석 결과 보존 |
| 5. ontology·모듈 조립 | 독립 동작, 공개 계약, 선택 설치, 이름 있는 인프라 binding 설계 | ontology-only 및 memory-only 실행에 다른 패키지의 부수 시작 없음; 미지원 인프라 조합의 거절 기준 명시 |
| 6. 배포 산출물·문서 | package files, build 경로, 설치 manifest, CI, 네 언어 README | 실제 패키지·source-only checkout에서 설명한 명령 실행 |
| 7. 최종 통합 | 독립 리뷰, 전체 repository gate, Podman 통합, 임시 자원 정리 | 모든 실패 해결·미확인 명시 후 작업 소유 변경만 커밋 |

순서는 의존 관계를 나타낸다. 이미 수행한 변경과 유효한 검증은 재사용한다. 지금 작업 트리에는 여러 단계의 초안이 있지만 전체 통합 완료로 간주하지 않는다. 기존 구현이 이 설계와 다르면 차이를 먼저 기록하고 조정한다.

각 단계는 호출자·테스트·fixture·config·export·빌드 경로를 함께 바꾼다. 파일 이동만으로 단계를 완료하지 않는다. 공개 호환 façade는 외부 사용처를 확인하기 전 제거하지 않는다. 사용자 데이터에 rollback을 적용하지 않고, 실패한 코드 변경만 작업 단위로 복구한다.

## 11. 최종 검증과 이번 설계의 경계

검증은 순수 정책 테스트, 실제 임시 파일·SQLite 통합, PostgreSQL/pgvector 동시성, 설치·패키징, 전체 제품 gate로 나눈다. 컨테이너는 **Podman**만 사용한다. 기존 서비스와 데이터는 사용하지 않고 작업 소유 fixture만 생성·정리한다.

최종 소스가 정해진 뒤 `npm run verify`를 한 번 실행한다. 이후 수정이 있으면 영향 있는 검사를 다시 실행한다. 실제 DB, cross-module MCP와 패키지 artifact 검증은 전체 gate에 포함됐는지 확인하고 빠진 항목을 별도로 수행한다. 소스가 바뀌지 않은 유효한 통과 결과는 반복하지 않는다.

독립 리뷰는 계층 이름뿐 아니라 업무 흐름이 실제로 application에 있는지, 권한·동시성·저장 계약이 보존됐는지를 확인한다. 모든 production/tooling 파일은 소유권 검사 범위에 포함하고 예외는 파일·이유 단위로 제한한다.

이 설계 단계에서는 소스 구현·스키마 변경·새 API·자동 실행 활성화·push·merge를 수행하지 않는다. 다음 구현의 첫 작업은 기존 미커밋 변경을 위 단계와 계약에 대조해 충족·누락·수정 필요를 나누는 것이다. 자동 실행과 실측 토큰 절감은 별도 기능 구현·평가가 필요한 미완료 영역이다.

MSA/복수 인프라 구현 시 추가 gate는 어댑터 계약 적합성, 조직 격리, 권한 취소, 캐시 장애·무효화, 메시지 중복·역순·ack 유실, relay 중단 후 재개, broker 장애, schema 혼합 버전, 원격 timeout 후 결과 조회, 데이터 cutover·복원이다. Kafka와 RabbitMQ 동시 사용을 지원한다고 표시하려면 두 브로커를 함께 실행하는 Podman 통합 검증이 필요하다. 이 설계 수정에서 해당 실행 검증은 수행하지 않았다.

## 12. 설계 검토 근거와 남은 판단

### 실제 구현과 목표의 차이

| 확인한 현재 경계 | 목표에 필요한 변화 | 판단 범위 |
| --- | --- | --- |
| `modules/loop/native.mjs`는 `unattended:false`, launcher의 `task` 명령은 미지원 | H에서 공통 Task·실행기 계약과 비코딩 작업 1개를 구현 | 자동 실행이 현재 존재한다는 주장을 배제 |
| API wire의 도구는 read_file/list_files/write_file이며 search_sources를 거절 | schema-first 도구 등록과 권한을 분리한 비코딩 연결 계약 | 알 수 없는 도구 거절은 보존할 안전 동작 |
| memory bootstrap은 DATABASE_URL 하나와 vectorBackend 하나를 사용 | D1에서 명명된 여러 인스턴스와 lifecycle·routing 검증 | 현재 복수 binding 지원으로 표시하지 않음 |
| pgvector는 memory write scope가 예약한 pool/session에 연결 | 이 consistency group은 모듈 안에 보존 | 일반 원격 DB로 바꿔도 동일한 보장이라는 주장 금지 |
| OAuth는 이미 복수 authorization server·issuer별 검증 상태를 가짐 | 기존 다중 issuer 기능을 유지하고 조직/trust realm binding을 확장 | 인증 전부를 새로 만들 필요 없음 |
| ingest_jobs는 visibility timeout으로 인덱싱 재시도를 claim | Execution 작업 소유권·fencing·결과 불명은 별도 계약 | 인덱싱 큐를 범용 실행기로 재명명하지 않음 |
| Memory goal-run은 호출자가 보고한 결과를 기록하는 API | Task-owned 투영과 legacy 쓰기 권한을 구분 | 보고된 종료와 검증된 Task 완료를 분리 |

### 대안 합성

후보 A는 현재 모듈형 모놀리스에 명시적 Task·Execution·Authorization·Usage·Evidence 소유자를 추가한다. 후보 B는 이 책임을 control plane으로 묶고 Memory·Code 등을 독립 resource worker로 배포한다. 비교 기준은 책임 완결성, 기존 계약 보존, 분산 실패 처리, 실제 코드와의 차이, 유한한 검증 범위다.

| 비교 기준 | A: 모듈 내부 책임 명시 | B: 제어면·worker 즉시 분산 |
| --- | --- | --- |
| 책임 완결성 | TaskController와 모듈별 소유자를 명시하면 충족 | 같은 소유자가 필요하며 배포 분리만으로 해결되지 않음 |
| 기존 계약·저장 정합성 | 현재 세션·transaction 경계를 유지하기 쉬움 | 원격 계약·데이터 전환이 먼저 필요 |
| 분산 실패 처리 | D 단계에서 계약별로 검증하며 확대 | 처음부터 결과 불명·재전달·routing 운영 필요 |
| 실제 코드와의 차이 | 기존 composition과 포트를 단계적으로 이행 | 현재 동기 SQLite·프로세스 단위 bootstrap의 변경 폭이 큼 |
| 검증 범위 | R→H→D의 합격 조건을 분리 가능 | 첫 인수부터 서비스 운영과 복구 검증을 요구 |

이는 부하 측정 점수가 아니라 현재 제약에 대한 설계 판단이다. 독립 리뷰도 A를 출발점으로 선택하고 B를 추출 목표로 유지하는 판단에 동의했다.

출발점은 A로 유지한다. B의 **실행 상태를 소유하는 쪽과 자원을 처리하는 쪽의 구분**을 A 내부 계약에 반영하고, B의 독립 배포는 D2 이후 선택한다. Control plane은 논리적 책임 묶음이며 하나의 전역 DB·필수 원격 서버가 아니다. 실행기와 resource worker는 canonical Task DB를 직접 쓰지 않는다. 이 결정으로 로컬 모듈 단독 사용과 기존 transaction을 유지하면서 서비스 추출 경계를 준비한다. 독립 배포부터 시작하는 비용은 현재 기능의 정합성 문제를 줄이지 못하므로 초기 필수 구성에서 제외한다.


2026-11-05 검토에서 `pstack:architect`의 경계·대안 비교, `pstack:interrogate`의 실행 가능한 반례 검토, `agent-harness-construction`의 도구·관측·복구 계약, `clear-writing`의 목표/현재 구분을 적용했다. `agent-architecture-audit`의 기억·도구·숨은 재시도 점검 항목은 설계 검토에 사용했으며, 미구현 런타임의 전체 운영 감사가 통과했다고 주장하지 않는다.

공식 문서도 분산 보장 범위를 확인하는 근거로 사용했다. Kafka의 외부 시스템까지 포함한 exactly-once에는 해당 시스템의 협력이 필요하다([Kafka 설계](https://kafka.apache.org/35/design/design/)). RabbitMQ의 publisher confirm과 consumer ack는 서로 다른 구간의 확인이며, confirm 응답 유실 후 재전송은 중복될 수 있다([RabbitMQ 확인 계약](https://www.rabbitmq.com/docs/confirms), [신뢰성](https://www.rabbitmq.com/docs/reliability)). PostgreSQL 비동기 replica는 primary의 최신 commit을 즉시 보여주지 않을 수 있다([PostgreSQL 16 복제](https://www.postgresql.org/docs/16/warm-standby.html)). 따라서 서비스 완료·외부 효과·최신성을 transport 성공만으로 판정하지 않는다.

실행한 설계 모델은 delta 역순 복구, stale worker 게시 차단과 외부 멱등성의 차이, 미확정 사용량 예약 보존, 현재 revision의 필수 증거 판정을 확인한다. 이는 작은 단일 프로세스 명세 예제이며 실제 동시성·브로커·DB·권한 시스템을 검증하지 않는다.

구현 전 확정할 운영 값은 목표 처리량·지연 SLO, 데이터별 RPO/RTO, 메시지 최대 보존·재전달 기간, 권한 철회 반영 시간, 인프라별 자원 한도다. 지금 임의의 숫자를 채우지 않는다. D 단계의 환경·부하가 정해지면 이 값을 명시하고 부하·장애 테스트의 합격 기준으로 고정한다.

## 12. 중단 지점과 재개 기준 (2026-11-05)

사용자 요청에 따라 현재 R 단계의 구현을 보존하고 검증·병합 후 중단한다. 이후 상태 질문만으로 새 구현을 시작하지 않는다.

- **구현 범위:** core, memory, code, ontology, wiki, 기존 실행 기반의 도메인·유스케이스·어댑터·조립 책임 분리. 기존 CLI/HTTP/MCP/export·저장 형식·조직 경계는 유지한다. 실제 경계와 검사 소유자는 [architecture.md](architecture.md)를 따른다.
- **검증 근거:** 루트 검증과 memory typecheck, 수정 영향 6개 파일의 95개 테스트, Podman PostgreSQL 246개 및 pgvector/쓰기 동시성 125개 테스트, 소스만 있는 선택 설치, 실제 memory 패키지 초기화, 코드·메모리 MCP 조직 격리 검사를 확인했다. 최초 전체 명령은 fixture 경로와 timeout 때문에 실패했으며 수정·영향 범위 재검증으로 대체했다. 코드 전체 877개 중 실패한 이전 경로·개수 전제 2건은 보완 후 영향받는 13개 테스트를 재검증했고, 자체 색인 2건·벤치마크·의존성 감사도 통과했다. 원격 CI는 PR의 실제 결과로 구분한다.
- **미구현:** H의 공통 Task 자동 실행과 D의 복수 resource binding·Kafka/RabbitMQ·MSA 배포. 기존 중지된 dispatcher를 활성화하지 않았다. 운영 SLO·RPO/RTO·부하 한도는 환경 확정 시 결정한다.
- **재개 순서:** 최신 main과 작업 트리 상태 → 이 문서 §9–11 및 [실행 계약](unified-execution-design.md) → 선택한 H/D 구현 단위와 실패 시나리오 → 해당 범위 구현·검증. 이미 유효한 R 검증을 이유 없이 반복하지 않는다.

상세 명령·원본 로그·정리 목록은 작업 환경의 `.harness/handoff/full-architecture-refactor/STOP-RESUME.md`와 같은 디렉터리에 보존한다. 이 로컬 기록은 배포 산출물이나 공개 API가 아니다.
