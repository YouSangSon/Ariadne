# Ariadne 통합 실행과 작업 연속성 설계

2026-11-02 설계안. 사용자 정책은 후속 grilling에서 확정했고, 이 문서는 구현 책임과 인수 기준을 정의한다.
확정 정책의 정본은 [작업 실행 정책](execution-policy.md)이다. 공개 checkpoint `59945ca`에는 A0와 제한된 연결 기반 요소가 있다.
활성 구현 worktree의 DB·runtime·dispatcher·CLI는 미커밋 초안이며 알려진 결함 때문에 게시·무인 실행 대상에서 제외했다.
이번 변경은 Trackmind 글에서 채택한 원리와 실제 초안의 결함을 설계·인수 기준에 반영하며 실행 구현을 재개하지 않는다.
현재 동작은 [README](../README.md), [코어 규칙](../core/AGENTS.core.md), 소스·테스트가 소유한다.
최초 설계 REQ는 [unified-execution-design](../.harness/reqs/unified-execution-design.yaml)이고,
이번 집행 경계 보완은 [harness-enforcement-design](../.harness/reqs/harness-enforcement-design.yaml)이 소유한다. 과거 AC와 근거는 보존한다.

## 1. 사용자가 가진 실행 도구만으로 작업을 이어 간다

Ariadne는 목표·결정·검증 근거를 보존하고, 실행 도구는 코딩을 담당한다.
Codex 하나, Claude Code 하나, Gemini 하나, Grok API 하나로도 같은 작업 관리 절차를 사용한다.
여러 실행기를 등록하면 허용된 후보 안에서 자동 배정하고, 사용자가 지정한 실행기를 우선한다.
공급자 사이의 인수인계는 공통 작업 기록을 전달하는 과정이다. 원본 대화와 credential을 합치지 않는다.

첫 완료 기준은 새 세션에서도 현재 목표·결정·검증 결과·다음 행동을 찾아 안전하게 재개하는 것이다.
예를 들어 Codex가 수정하고 종료된 뒤 Claude Code로 이어 달라고 하면, 현재 Git 상태와 미확정 실행부터 대조한다.
이미 통과한 검사도 소스·명령·환경이 같을 때만 재사용한다. 이전 실행이 끝났는지 불명확하면 쓰기 담당을 넘기지 않는다.

현재 Mac에서 작업 기억·재개를 먼저 완성한다. 기존 도구 화면과 공통 CLI, 맡긴 작업의 후속 처리,
품질 우선 배정·안전 확인 뒤 자동 재개·승인된 failover·동시 상한 2·작업 전체 예산은 확정 정책이다.
그 조건과 예외는 [정책 본문](execution-policy.md)이 소유한다. 아래 절은 이를 집행하는 기술 책임을 설명한다.

로그인은 연결 가능성을 확인하는 단서다. 실행 허가, 모델 접근 권한, API 결제 승인으로 확대하지 않는다.
이 설계의 확정은 구현·설치·모델 호출의 실행 승인이 아니다.

## 2. 현재 코어를 유지하고 실행 관리를 선택 기능으로 둔다

현재 Ariadne는 REQ, Git, handoff, context pack, 공통 스킬과 로컬 verify를 제공한다.
`scripts/verify.mjs`는 테스트·미러·커밋 메시지를 검사하며 AC별 근거의 진실성이나 실행 수명을 자동 관리하지 않는다.
공개 `modules/loop/`에는 REQ 계약·소스 지문·파일 경계·HTTP 전송·수동 native 패킷 helper가 있다.
작업 DB·실행 풀·자동 인수인계·완료 봉인의 제품 적용은 미완료다. 미공개 초안이나 이 설계의 API 이름을 현재 사용 가능한 기능으로 안내하지 않는다.

| 계층 | 소유 책임 | 추가하지 않는 책임 |
| --- | --- | --- |
| 공통 코어 | 요구사항·불변 AC·문맥 팩·검증 근거·인수인계, 단독 수동 사용 | DB·daemon·공급자 SDK를 필수 의존성으로 만들지 않음 |
| 선택 실행 모듈 `modules/loop/` | 작업 상태·실행 풀·배정·승인·수명·복구·이벤트 연결 | 별도 두 번째 자율 루프나 글로벌 모델 정책을 만들지 않음 |
| 실행기 어댑터 | 공급자별 시작·관측·재개·취소와 기능 확인 | 작업 완료·새 권한을 자체 선언하지 않음 |
| 실행 환경 | worktree·도구·OS 권한·비밀 접근 통제 | Router 프롬프트를 보안 격리로 취급하지 않음 |

`modules/loop/`는 기존 [DESIGN의 P7 구상](../DESIGN.md#410-goalloop-운영-v4--웹github-루프-리서치-반영)을 대체하는 단일 실행 관리 경계다.
과거 Stop hook 재주입안을 병행하지 않는다. 이벤트·작업 상태를 기준으로 시작과 종료를 관리한다.
P7 구축 보류는 이번 요청으로 설계 범위에서 재검토한다. 실제 자동 실행 활성화는 검증과 별도 승인 이후다.
P8 실제 평가나 공급자 선택을 설계·로컬 문맥 보강의 선행 질문으로 삼지 않는다.

## 3. 공급자·실행 방식·계정·모델을 분리한다

`Executor`는 사용자가 등록한 실행 단위다. `provider`는 공급자이고, `mode`는 실행 루프의 소유자를 뜻한다.
같은 공급자라도 CLI 로그인과 API key 연결은 별도 executor로 등록한다. 하나의 계정 정보를 다른 연결에 복사하지 않는다.

| 항목 | 최소 계약 |
| --- | --- |
| 식별 | `executor_id`, `provider`, `mode: native_agent 또는 model_api`, 설치·프로토콜 버전 |
| 선택 | `enabled`, 사용자 우선순위, 허용 project·role·action, 모델·effort 정책 참조 |
| 인증 | `auth_ref`와 `auth_state: ready, unavailable, unknown`만 보존. credential 원문은 저장하지 않음 |
| 기능 | 구조화 출력·관측·native resume·steer·취소 확인·효과별 승인·정책 철회·control state 격리·workspace 제한·usage 관측의 지원 여부 |
| 가용성 | `available, busy, cooldown, unavailable, unknown`, 마지막 확인 시점과 원인 |
| 실행 한도 | 승인된 동시 실행 수·시간·시도·사용량 정책. 모르는 quota·요금을 0이나 무제한으로 기록하지 않음 |

기능 값은 `supported`, `unsupported`, `unverified`로 구분하고 확인한 버전·근거를 연결한다.
인증·기능 조회를 위한 read-only 진단과 추론을 발생시키는 유료 smoke는 분리한다.
최소 코어 기능만 쓰면 실행기 등록은 없어도 된다. 실행을 요청했는데 적격 실행기가 없으면 `blocked`로 이유를 반환한다.

| 연결 후보 | 공식 문서에서 확인한 경로 | 설계상 취급 |
| --- | --- | --- |
| Codex native agent | [SDK](https://learn.chatgpt.com/docs/codex-sdk), [App Server](https://learn.chatgpt.com/docs/app-server) | SDK·`codex exec`로 제한된 작업부터 검증. steer·승인·지속 관측은 버전별 App Server 계약을 확인 |
| Claude Code native agent | [프로그램 실행](https://code.claude.com/docs/en/headless), [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) | 공식 CLI 또는 SDK. 기존 로그인 사용과 SDK의 인증 조건을 각각 검증 |
| Gemini native agent | [headless](https://geminicli.com/docs/cli/headless/), [CLI reference](https://geminicli.com/docs/cli/cli-reference/) | 구조화 결과·session resume 경로는 문서 근거. 실제 취소·승인·격리는 별도 qualification |
| Grok model API | [xAI function calling](https://docs.x.ai/developers/tools/function-calling) | 모델이 도구 호출을 요청하고 호스트가 실행하는 경로. Grok 웹 로그인이나 공식 CLI 존재를 가정하지 않음 |
| 그 밖의 모델 API | 공급자별 공식 계약과 실제 호환성 검사 | 전송 형식이 비슷해도 도구·사용량·오류·취소·reasoning 상태의 동등성을 가정하지 않음 |

2026-11-02 공식 문서 확인이며 설치·계정 접근·실제 추론을 검증한 표가 아니다.
현재 사용자의 모델·effort·전역 설정을 유지한다. 기존 미커밋 `models/portfolio.json`의 오래된 배정을 새 정책으로 활성화하지 않는다.
역할별 모델 정책은 사용자 소유 중앙 정책을 참조하고 어댑터마다 복제하지 않는다.

## 4. 실행 루프의 차이는 어댑터 경계 안에 남긴다

| 책임 | `native_agent` | `model_api` |
| --- | --- | --- |
| 모델과 도구의 반복 | 기존 코딩 에이전트가 소유 | Ariadne의 제한된 tool loop가 소유 |
| 세션 | 공급자 session·thread ID를 참조 | 공급자 conversation 참조 또는 필요한 공개 메시지·도구 결과를 호스트가 보존 |
| 도구 권한 | 해당 에이전트의 승인·sandbox와 호스트가 확인한 제한 | 호스트가 매 호출의 인자·권한·경로·예산을 검사하고 실행 |
| 재개 | 같은 executor·계정·workspace·버전과 실제 model·effort·sandbox·approval 설정 일치를 확인한 뒤 native resume | 공급자가 요구하는 상태·도구 호출 순서를 보존하여 재개 |
| 도구 전환 | 공통 패킷으로 새 실행을 생성 | 같은 방식. 비공개 추론·서명 블록·원본 credential은 이식하지 않음 |

공통 어댑터 계약은 `inspect`, `start`, `observe`, `request_stop`과 정규화된 실행 이벤트다.
`resume`과 `steer`는 선택 기능이다. 지원하지 않으면 명확한 오류나 새 실행으로의 인수인계를 사용한다.
`start`가 반환한 handle은 접수 근거다. 성공·종료 근거가 아니다. 요청 ID는 같은 내용의 재조회에 사용하고 내용 hash를 함께 묶는다.
오류는 `auth, quota, policy, tool, environment, model, verification, unknown`을 구분한다.
원본 공급자 오류 참조를 유지하며 취소 불확실성을 `failed`로 덮지 않는다.

공통 이벤트 필드는 `event_id, project_id, task_id, run_id, generation, policy_revision, type, artifact_ref`다.
adapter는 결과·usage·승인 필요·heartbeat·종료 관측을 정규화하되 원본 근거와 정보 누락 여부를 남긴다.
세부 JSON schema와 공급자별 fixture는 구현 REQ에서 고정한다. 이 문서는 새 HTTP endpoint를 정의하지 않는다.

## 5. 얇은 Router가 실행 풀을 배정한다

Router는 새 입력의 작업 관계를 찾고 배정하며 사용자에게 결과를 모아 전달한다.
구현·복잡한 설계·통합 판단은 Worker가 맡는다. Worker는 executor에서 동작하는 작업별 실행이다.
단일 실행기에서는 같은 실행기를 순서대로 사용하고, 독립 검토가 필요하면 새 맥락의 다른 run을 만든다.
다른 공급자가 없다는 이유로 작업을 막지 않으며, 공급자가 다르다는 이유만으로 검토가 독립적이라고 인증하지 않는다.

배정은 다음 순서의 결정론 코드로 시작한다.

1. 사용자 명시 지정이 있으면 해당 executor만 검토한다. 사용할 수 없으면 이유를 보여 주고 대기한다.
2. 활성화·프로젝트 허용·현재 승인·모델 정책·필수 기능을 만족하는 후보를 고른다.
3. 역할별 검증 결과로 완료 품질 하한을 만족하는 후보를 남긴다. 공급자 이름·크기·가격을 품질 점수로 쓰지 않는다.
4. 품질 조건을 충족한 후보의 가용성·동시 실행 슬롯·사용자 우선순위와 확인된 속도·usage를 비교한다. 모르는 수치는 추정 점수로 채우지 않는다.
5. 후보가 없으면 대기나 `blocked`를 기록한다. 다른 계정·미승인 유료 API로 자동 우회하지 않는다.

새 요청이 어느 작업인지 모호할 때만 필요 범위의 의미 판단을 사용한다.
이미 구독 관계가 있는 후속 이벤트마다 LLM Router를 호출하지 않는다. 별도 경량 모델을 강제하지도 않는다.
Task 귀속과 승인 예산을 정하지 못한 입력에는 새 모델 라우팅 호출을 시작하지 않고 수동 연결을 요청한다.
배정 사유와 제외 사유를 남긴다. 작업 성격별 우선순위는 사용자 설정이며 특정 공급자가 항상 더 낫다고 내장하지 않는다.
로그인된 모든 도구에 같은 작업을 중복 발사하지 않는다.
[자동 전환 정책](execution-policy.md#실행기를-고르거나-바꾸면)에 따라 자동 배정 작업만 허용 후보로 failover한다.
run에는 `selection_origin: automatic 또는 explicit`과 배정 사유·후보 제외 사유를 보존한다.
명시 지정은 실행기 unavailable을 이유로 automatic으로 바꾸지 않는다. 사용자 변경만 selection revision을 갱신한다.
dispatch와 효과 승인도 현재 selection revision에 묶어, 늦은 자동 배정이 새 명시 지정을 덮지 못하게 한다.
자동 전환도 §6의 소유권 이전·종료·효과 대조와 동일 Task 잔여 예산을 사용한다.

## 6. 명시적 전환은 소유권을 넘기는 절차다

같은 작업을 다른 executor로 이어 달라는 요청은 즉시 두 번째 writer를 만드는 명령이 아니다.
전환은 새 task를 만들지 않고 새 run과 generation을 만든다.

1. 현재 run에 후속 쓰기 배정을 막고 steer 또는 stop을 요청한다.
2. 같은 handle로 종료·작업 소유 child·미확정 효과를 확인한다. 확인할 수 없으면 전환은 대기한다.
3. worktree·HEAD·dirty·untracked 입력과 검증 범위를 관측하고 handoff 패킷을 만든다.
4. 새 executor의 기능·승인·비용·데이터 반출 범위를 확인한다.
5. 쓰기 소유권을 새 run에 넘기고 새 실행을 시작한다. 이전 generation의 늦은 결과는 참고 근거로만 보존한다.

같은 executor의 native resume는 가능한 경우의 최적화다. 공급자 전환과 native resume를 같은 보장으로 부르지 않는다.
현재 실행 설정의 fingerprint를 조회·대조할 수 없거나 필요한 설정 변경이 resume에 반영되지 않으면 native resume를 거절하고 새 run을 만든다.
이전 run이 종료된 경우 기존 작업 공간을 넘길 수 있다. 다른 공간으로 옮기면 task-owned patch만 검토 후 적용한다.
사용자 미커밋 파일·index를 덮어쓰거나 자동 stash·reset으로 맞추지 않는다. 파일 동등성을 입증하지 못하면 과거 검증을 재사용하지 않는다.

## 7. REQ·실행 기록·원본 근거의 소유권을 나눈다

REQ가 목표·AC의 원본이고 Git이 코드의 원본이다. 실행 DB가 이를 다른 목표로 다시 쓰지 않는다.
최초 지원은 개인 프로젝트의 명시 등록이다. 회사 저장소를 자동 발견해 실행 풀에 추가하지 않는다.

| 레코드 | 핵심 필드와 불변식 |
| --- | --- |
| Project | 안정된 `project_id`, 사용자가 승인한 canonical root·worktree, 데이터 경계 |
| Task | `task_id`, REQ 경로·contract hash·revision, 목표 상태, 다음 행동, source fingerprint |
| Run | `run_id`, task revision·generation, executor·native session·실행 handle, workspace owner, 정책·한도 |
| Grant | 허용 action·resource·executor·데이터 범위·유효기간·예산, 승인 근거, policy revision |
| Thread·Event | provider의 안정 ID·project·source·대상 repo·thread, 원본 hash, 수신·처리 상태 |
| Delivery·Outbox | event와 run의 전달·ack, 외부 알림의 승인·접수·결과. 각각 idempotency key |
| Effect·Evidence | 요청 내용 hash·handle·관측 상태, criterion·검사·exit·source·artifact hash |

첫 구현은 로컬 단일 호스트다. 실행 관리 모듈만 SQLite 트랜잭션과 호스트 전체의 단일 dispatcher를 사용한다.
Node 24의 `node:sqlite`를 사용하되 구현 전에 실제 지원 버전·기능을 고정한다. 코어 최소 버전을 일괄 올리지 않는다.
권위 있는 executor 등록·Grant·policy·workspace claim·실행 상태는 호스트의 `~/.harness/runtime/` control DB에 둔다.
Worker의 쓰기 범위 밖에서 관리하며 실행기 자체·shell·설정 파일 변경으로 이 경계를 우회할 수 없는지 qualification한다.
디렉터리 mode 0700·파일 0600만으로 같은 OS 사용자 worker를 격리했다고 간주하지 않는다. 기계적 차단이 없으면 무인 실행을 허용하지 않는다.
프로젝트의 `.harness/runtime/`는 필요한 비권위 projection만 두고, 원본 DB로 역수입하여 승인·owner를 바꾸지 않는다.
구현 시 ignore·최소 권한·백업·제거 계약을 추가한다. DB·event payload·artifact는 project ID로 분리해 다른 프로젝트 Worker에 노출하지 않는다.
공통 목록에는 ID·상태·허용 root만 둔다. 작업에 필요한 프로젝트의 payload만 승인된 조회로 전달한다.
초기 내구성은 프로세스 crash·Mac 재시작을 다룬다. 디스크 유실·다른 기기로의 복제·클라우드 상시 운영은 보장하지 않는다.

dispatcher는 호스트 control root의 배타적 실행 잠금을 획득한 뒤 동작하고, 두 번째 프로세스는 조회·제어 클라이언트로만 연결한다.
잠금의 자동 시간 만료로 기존 dispatcher가 사라졌다고 추정하지 않는다. 시작할 때 미완료 run과 실제 handle을 먼저 대조한다.
unknown run의 전역·executor 슬롯과 workspace claim은 유지한다. 종료·효과 확인 전 같은 슬롯이나 writer 권한을 재발급하지 않는다.
대조가 끝나면 §8의 자동 재개 판정으로 넘긴다. 시작 시 모든 작업을 다시 발사하는 복구 경로는 만들지 않는다.

### 7.1 복구에서도 dispatcher 소유권을 하나로 유지한다

PID 파일의 부재·프로세스 미발견·시간 만료는 소유권 획득 근거가 아니다. 다른 복구자가 새로 만든 lock·socket을 지우는 경로를 제거한다.
최초 운영은 로컬 디스크의 canonical control root 하나다. 실행 중 root·DB 파일 교체나 복제본을 통한 두 번째 운영 인스턴스를 허용하지 않는다.

- `owner.sqlite`의 전용 연결이 rollback journal 모드의 `BEGIN IMMEDIATE`를 dispatcher 수명 동안 유지한다. 운영 상태는 별도 `control.sqlite`에 짧은 트랜잭션으로 commit한다.
- 소유 잠금을 먼저 획득한 뒤 control DB 열기·migration·epoch 증가·socket 대조를 수행한다. busy이면 기존 dispatcher의 클라이언트로 연결하거나 blocked를 반환하며 잠금을 삭제하지 않는다.
- 기존 PID 잠금 protocol은 owner DB를 사용하지 않으므로 새 잠금 획득이 구 dispatcher 종료의 증거가 아니다. 구버전 실행의 생존/종료가 불명확하면 새 운영 시작·migration·control DB 쓰기·socket 정리를 차단한다. 모든 구버전 담당·child 종료와 효과를 명시 관측한 offline 전환 뒤에만 새 protocol로 이행한다.
- 새 owner는 control DB의 단조 증가 `dispatcher_epoch`를 commit한다. 모든 상태 변경·효과 접수·결과 반영·자원 정리는 현재 epoch를 확인하며, 이전 epoch의 늦은 결과는 감사 기록에만 남긴다.
- 종료는 새 접수 차단 → 현재 실행의 종료·unknown 기록 → 자기 socket 정리 → owner 연결 해제 순서다. owner DB와 journal을 임의 삭제하지 않는다.
- crash로 OS가 연결 잠금을 해제해도 기존 run·effect·검증의 불명확성과 예약은 유지한다. epoch는 이미 접수된 외부 효과를 취소하거나 기존 native 실행 종료를 입증하지 않는다.

단일 호스트·확인한 로컬 filesystem·신뢰하는 control root가 보장 범위다. live owner의 무진전을 이유로 TTL 탈취하지 않으며 관측·명시 중지로 해소한다.
Node 24.22.2 / macOS의 작은 실험에서 두 번째 writer 거절, 별도 control DB commit, owner 프로세스 종료 후 획득을 확인했다.
이는 SQLite 잠금 전제 확인이며 dispatcher 복구·native 격리·디스크 장애 복구의 제품 검증은 아니다.

트랜잭션은 이벤트 저장·작업 연결·전달 예정 기록을 함께 반영한다.
여러 프로세스가 JSON 파일을 나눠 쓰는 자체 트랜잭션이나 별도 큐 서비스를 만들지 않는다.
REQ의 기계 판독은 현재 canonical YAML 지원 범위에서 실패를 명시한다. 정식 의미 해석이 필요하면 검증된 파서를 채택한다.
receipt JSON은 파생 근거이며 새로운 AC 원본이 아니다. 기존 verified REQ는 legacy 기록으로 보존하고 신규 봉인을 소급 인증하지 않는다.

## 8. 작업 상태와 실제 실행 상태를 구분한다

Task 상태는 REQ의 기존 상태 enum을 대체하지 않는다. REQ가 `ready_for_routing`이어도 실행 Task는 승인 대기일 수 있다.
기존 REQ에 새 runtime 상태를 몰래 추가하지 않는다.

| Task 상태 | 의미·허용 전이 |
| --- | --- |
| queued | 작업을 기록했으며 배정 조건을 기다림. 허용되면 running |
| running | 현재 run이 담당. 승인·입력 필요 시 awaiting_user, 오류 판단 시 blocked, 근거 준비 시 verifying |
| awaiting_user | 승인·질문을 기다림. 현재 정책을 다시 확인한 뒤 재개 |
| blocked | 필요한 도구·근거·권한·효과 확인이 없음. 새 근거가 있어야 재개 |
| verifying | 현재 revision의 AC와 검증 근거를 확인. 통과하면 completed, 부족하면 running 또는 blocked |
| stopped·cancelled | 사용자 중지 또는 확인된 취소. 자동 재개 금지. 명시적 재개는 새 run을 생성 |
| completed | 해당 revision에서 완료되어 실행 의도가 종결됨. 이후 명시 재검증의 현재 유효성은 receiptValid로 별도 판정하며 자동 실행 대상에는 복귀하지 않음. 새 요구/수정 실행은 명시한 새 revision·승인으로 진행 |

| Run·효과 관측 | 판정 |
| --- | --- |
| starting·accepted·running | 접수·실행 관측. 완료 아님 |
| waiting_approval·cancel_requested | 대기·중단 요청. 종료 아님 |
| succeeded·failed·cancelled | adapter가 정의한 terminal 근거와 child 정리를 확인한 실행 결과 |
| unknown | timeout·연결 단절·접수 응답 유실·복구 후 실행 결과 불명확. 재조회 전 자동 재실행 금지 |

Run의 성공은 Task 완료를 뜻하지 않는다. 원격 프로세스 exit 0이나 모델의 완료 문장만으로 AC를 통과시키지 않는다.
중지 요청은 durable하게 먼저 기록한다. watchdog·앱 재시작이 이를 취소하지 않는다.
요구 변경은 task revision, 실행 교체는 generation, 권한 변경은 policy revision으로 구분한다.
상태·완료 반영은 이 값과 workspace 소유권이 현재 값일 때만 허용한다. 이전 결과는 감사 기록에만 남긴다.

[자동 재개 정책](execution-policy.md#mac이나-ariadne를-다시-켜면)은 관측 복구와 새 실행 시작을 구분해 집행한다.
기존 run이 살아 있으면 같은 handle에 관측만 재연결한다. 새 run을 만들려면 종료·child·효과 확인을 끝내야 한다.
현재 Task revision·source·Grant·정책·한도·실행기 기능을 모두 대조하고, 충돌이나 변화를 해소하지 못하면 blocked 또는 awaiting_user로 남긴다.
중지·취소·승인 대기·unknown은 자동 실행하지 않는다. 만료된 승인을 복구하지 않으며 재개에서도 원래 Task 예산을 이어 쓴다.

## 9. 동시 실행과 복구는 관측 가능한 효과를 기준으로 한다

작업별 격리된 worktree를 우선한다. 동일 workspace에는 writer 하나만 둔다.
읽기 전용 검토는 같은 고정 source snapshot을 사용할 수 있다. read-only 프롬프트만으로 쓰기 금지를 보장했다고 보고하지 않는다.
초기 전역 실행 상한은 [동시 실행 정책](execution-policy.md#여러-실행을-함께-진행하면)에 따라 2이며 executor별 더 낮은 한도도 함께 적용한다.
자식 run·검토·재시도도 합산한다. 단일 run qualification 뒤 독립 실행 두 개와 세 번째 실행의 대기를 검증한다.
자동 실행에 필요한 한도·실행 허가가 없으면 관측만 한다. 무한 루프와 한도 없는 투기 실행은 허용하지 않는다.

슬롯은 접수 중·실행 중·종료 미확인 run이 사용한다. 단순 대기 Task는 사용하지 않지만, 효과가 불명확한 run은 해제하지 않는다.
LLM Router를 사용하는 경우도 호출 run과 usage를 계상한다. 결정론 dispatcher와 상태 조회는 모델 실행 슬롯을 소비하지 않는다.
동기적으로 child 완료를 기다리는 부모가 슬롯을 점유한 채 새 child를 무한 대기시키지 않는다.
모델·도구 실행을 멈췄다는 adapter 확인으로 부모를 suspend할 수 있으면 슬롯만 양도하되 workspace claim과 Task 예산은 유지한다.
유지한 writer claim과 충돌하는 같은 workspace의 쓰기 child는 거절하고 다음 실행 경계로 넘긴다. 부모는 시작되지 않은 child의 완료를 기다리지 않는다.
부모 재개도 dispatcher를 거쳐 현재 승인·예산·실행 슬롯을 다시 확보한다. 같은 writer claim을 넘기려면 §6의 종료·효과 확인이 먼저다.
이 보장이 없으면 child launch를 capacity 부족으로 반환하고 queue·다음 실행 경계에서 처리한다. child를 시작한 것처럼 보고하지 않는다.
native 내부 child도 관측·통제할 수 있어야 한다. 이를 셀 수 없으면 내부 위임을 비활성화하고, 비활성화도 보장하지 못하면 무인 후보에서 제외한다.

내구성 dispatch는 실행 전에 `intent + request hash`를 저장하고 결과를 저장한 뒤 다음 단계를 진행한다.
crash 뒤 running intent는 `unknown`으로 재분류하여 같은 handle·공급자 요청 ID·workspace 효과를 조회한다.
프로세스 PID만으로 다른 작업을 중지하지 않는다. PID 재사용을 구분할 수 있는 시작 시각·소유 실행 정보를 함께 확인한다.
조회 수단이 없으면 사람의 확인을 기다린다. intent 기록과 외부 시스템 효과 사이의 원자성은 주장하지 않는다.

전달은 at-least-once를 전제로 중복 접수와 반복 효과를 분리한다. 외부 효과의 exactly-once는 보장하지 않는다.
이벤트 저장만으로 실행 성공을 인증하지 않으며, durable ack 전에 crash가 나면 기존 실행과 대조한다.
중복 차단 레코드는 임의 TTL로 지우지 않는다. source 재전송·재개 범위를 포괄하는 보존 정책을 정하고 삭제를 검증한다.
의미 없는 요약 변경은 진전이 아니다. 실패 gate·source·입력·근거 fingerprint가 같으면 새 시도를 허용하지 않는다.

## 10. 문맥과 완료 근거를 실행기 사이에 전달한다

handoff 패킷의 필수 내용은 목표·확정 결정·AC·권한 경계·현재 source·진행 handle·미해결 효과·다음 행동이다.
`verification.commands`, gate 이유, `escalate_after`, 이전 attempts와 evidence 참조도 필수다.
A0는 `lib/context-pack.mjs`의 verification·`confirmed_facts` 필수 보존과 ID·상태·예산 검사를 보완했다.
다음 경계는 텍스트 context와 별도로 직렬화하는 raw AC·event·tool 결과까지 동일한 반출 정책을 거치게 하는 것이다(§11.2).

짧고 필요한 내용은 inline으로 넣고, 긴 로그는 `artifact_id + hash + 위치·범위 + 보존 수명` 참조로 넘긴다.
프로젝트 경계 안에서 참조를 조회하고 path traversal·symlink escape·다른 프로젝트 artifact를 거절한다.
원본은 저장·출력 전에 비밀을 가리며 전체 홈·환경·인증 cache를 수집하지 않는다. scrub은 완전한 비밀 차단 보장이 아니다.
필수 내용이 예산을 넘으면 조용히 자르지 않고 더 큰 예산·작업 분할·명시적 조회를 요구한다.
참조가 없거나 hash가 다르면 근거 미확인으로 표시한다. SQLite나 artifact 목록으로 충분하며 초기 graph DB는 필요 없다.

완료 봉인은 다음 조건을 모두 확인하는 기계 판독 근거 묶음이다.

- 확정한 criterion ID·본문의 contract hash가 현재 REQ와 같다.
- 모든 AC와 `verify_gate_required: true`인 경우의 `verification.commands` 전체를 판정한다. 필수 gate 명령이 비어 있으면 계획 오류이며 완료하지 않는다.
- 각 check의 가장 최근 시작 시도를 먼저 선택한 뒤 결과·소스·환경을 대조한다. 과거 passed만 골라 검색하지 않는다. pending·실패·취소·unknown·수집 오류·skipped는 통과가 아니다.
- command는 controller가 실제 exit·signal·출력 한도·수집 오류를 확인한다. `GATE: PASS` 문자열이나 모델이 제출한 evidence JSON은 권위 있는 결과가 아니다.
- 사람의 관측은 관측자·범위·시각·판정을 구분하고 명령 exit code를 지어내지 않는다.
- 검사 대상 파일의 종류·mode·hash, dirty·untracked 입력, 명령·cwd·도구 버전·설정 범위가 현재와 동등하다.
- artifact가 존재하고 hash가 맞으며 미해결 효과·필수 승인·정리 대기가 없다.

HEAD는 provenance이며 동일 소스의 충분조건이 아니다. 같은 내용의 새 커밋은 명시한 동등성 검사로 통과 근거를 재사용할 수 있다.
AC 계약 hash와 검사 소스 hash는 분리하여 REQ 상태·근거 기록 때문에 스스로 무효화되는 순환을 피한다.
hash는 연결·변경 탐지 수단이다. 모델이 쓴 주장의 의미적 진실성이나 악의적 writer에 대한 변조 방지를 보장하지 않는다.
검증기는 실제 명령 결과를 수집하고, 고위험 변경은 현재 사용자 정책의 독립 리뷰를 거친다.

### 10.1 검증 시작부터 완료 봉인까지 같은 판정을 사용한다

호출자 경험은 `검사 요청 → 관측 결과 확인 → 완료 또는 이유가 있는 거절`이다. 아래는 구현 전 계약 스케치이며 실행 가능한 API가 아니다.

```text
runtime.check(taskId, checkKey, approvedObservationRequest) -> CheckAttempt
runtime.complete(taskId) -> {accepted: true, receipt} | {accepted: false, reasons}
runtime.status(taskId) -> {state, receiptValid, blockingChecks}
```

`check`·`complete`·`status`의 판정은 계획한 `modules/loop/verification.mjs` 한 곳이 소유한다.
server는 입력·actor 권한을 확인하고 runtime에 전달한다. store는 트랜잭션·단조 순번과 owner epoch를 소유한다.
완료 판정용 SQL·해시·순서 조건을 CLI와 adapter에 복제하지 않는다.

| 데이터 | 소유·필수 내용 |
| --- | --- |
| VerificationPlan | canonical REQ의 모든 AC ID·본문·verification과 필수 gate에서 파생. 안정된 `check_key`, 정확한 실행/관측 방법, `plan_hash`. 별도 JSON criteria를 원본으로 받지 않음 |
| VerificationScope | 승인한 argv·cwd, 실행 파일/도구 버전, 비밀 원문 없는 유효 설정·환경, 의존성·입력 범위. Git 이력/index를 읽는 검사는 해당 이력·index 식별도 포함 |
| CheckAttempt | DB가 시작 시 부여한 `attempt_seq`, task revision·check_key·plan/contract/source/scope hash·owner epoch, 접수 actor, 상태, 실제 결과와 artifact 참조 |
| Receipt | 현재 필수 check 전부의 선택 attempt ID·scope·source·artifact hash와 봉인 버전. 원본 근거와 과거 봉인은 변경하지 않음 |

1. 계획은 기존 REQ에서 파생한다. 실행 파일은 승인된 host 환경에서 해석한 실제 경로·identity로 고정하며 basename만 같다고 허용하지 않는다. 호출자가 passed·순번·소스 해시를 제출해 판정을 만들 수 없다. 같은 명령·cwd·scope인 AC와 gate는 실제 한 번 실행한 결과에 함께 연결할 수 있지만 필수 항목을 누락할 수 없다.
2. controller는 command를 띄우기 전에 시작 시도·예약·현재 완료 유효성 보류를 함께 commit한다. UUID나 시각 문자열 정렬을 실행 순서로 사용하지 않는다.
3. 검증은 같은 workspace의 쓰기 소유권과 공통 슬롯을 확보하며 명령·child·근거 수집이 끝날 때까지 반환하지 않는다. 테스트는 임의 코드를 실행하므로 모델이 argv를 골라 자동 발사하는 shell 도구가 아니다.
4. artifact는 task-owned 임시 파일에 쓰고 flush·원자 교체·hash 대조를 끝낸다. DB 반영 전 남은 orphan 파일은 통과 근거가 아니다. 실행 전후 source·계약·scope·epoch를 대조한 다음 결과·artifact 참조·예약 정산을 함께 commit한다. spawn 실패·관측 유실·수집 중 crash도 시작 시도가 남아 과거 성공을 가린다. 종료·효과가 불명확하면 슬롯을 유지한다.
5. `complete`는 같은 트랜잭션에서 현재 plan과 각 check의 최신 시작 시도 및 미해결 실행을 대조하고 봉인·상태를 반영한다. 새 검사 시작과 완료 요청이 경합해도 한 순서로 정렬된다.
6. `status`도 같은 판정기를 사용한다. 봉인 후 시작한 검사·최신 실패·필수 조건 변경은 현재 유효성을 보류/무효로 만들며 과거 봉인 자체를 삭제하지 않는다. 명시 재검증 중/실패 뒤에도 종결된 Task.state는 completed로 유지한다. status는 receiptValid와 구체 blocker를 함께 반환하고 state만 보고 현재 검증 완료라고 표시하지 않는다. 새 이벤트·재시작·watchdog는 이 Task를 queued/running으로 바꿀 수 없다. 새 수정 실행은 명시한 새 revision·승인으로만 시작하며 Task 누적 예산은 유지한다.

`verification`의 관측 가능한 술어는 사람이 승인한 구조화 관측으로 기록할 수 있다. command 요구를 메모로 대체하거나 알 수 없는 문법을 임의 추론하지 않는다.
parser가 지원하지 않는 검증 방법·scope는 qualification 미완료로 명시하고 자동 완료를 거절한다. 필요하면 REQ 원본을 명시적으로 정정한 뒤 새 revision·승인으로 진행한다.
일반 source 해시만으로 Git-ignored dependency·환경·이력·index까지 동일하다고 보지 않는다. 선언한 검증 범위의 필수 입력을 관측할 수 없으면 근거 재사용을 거절한다.
같은 내용의 새 commit은 해당 check가 이력 비의존임을 확인한 경우에만 재사용한다. 새로운 실패를 지우기 위한 과거 성공 선택은 허용하지 않는다.

### 10.2 기존 기록과 schema를 보존한다

새 CheckAttempt/봉인은 version을 명시한다. 기존 verified REQ와 legacy receipt는 과거 기록이며 자동으로 새 판정의 인증을 얻지 않는다.
기존 source·로그·계약에 필요한 필드가 없으면 신규 검증으로 수집한다. 근거를 잃은 기록을 실패로 꾸미거나 기존 AC를 소급 변경하지 않는다.
control DB의 다음 schema는 §7.1의 구 protocol offline 종료 확인과 새 owner 획득·새 실행 접수 중지·소유 실행/효과 대조 뒤 백업하고 migration 트랜잭션으로 전환한다. 구버전이 살아 있거나 불명확하면 read-only 진단 외의 전환 작업은 하지 않는다.
버전을 모르는 binary는 쓰기를 거절한다. 구버전 재기동이 새 봉인을 해석했다고 보지 않으며, rollback은 실행이 멈춘 상태에서 일관된 백업 복원 또는 검증한 역이전으로만 한다.

## 11. 권한과 비용을 공급자 전환에서도 유지한다

등록·인증·문맥 전달·실행 승인은 별개다. 이벤트 본문·PR 댓글·위임 보고가 Grant를 만들거나 확대할 수 없다.
각 dispatch와 재개·전환·효과 실행 직전에 현재 policy revision·범위·유효기간을 다시 확인한다.
정책 철회는 durable한 stop fence를 먼저 반영하고 새 효과·배정·승인 응답을 차단한 뒤 현재 run의 stop을 요청한다.
이미 승인·접수된 효과를 철회로 되돌렸다고 주장하지 않는다. 해당 효과와 child는 기존 handle로 확인하고 불명확하면 unknown으로 남긴다.
개인 프로젝트끼리도 데이터 반출 범위가 다를 수 있다. 새 공급자에 문맥을 보내기 전 허용 범위를 검사한다.
사용자의 공식 로그인 흐름과 CLI 자체 인증을 사용하며 credential을 추출·중계하거나 브라우저 cookie를 재사용하지 않는다.
구독 quota와 API 과금은 따로 취급한다. quota 소진을 이유로 미승인 유료 API에 자동 전환하지 않는다.

native agent는 확인한 sandbox·승인·도구 제한을 사용한다.
효과별 host 승인 경계나 동등한 기계적 철회 경계가 있어야 무인 실행에 허용한다. host가 응답하지 않으면 새 효과는 거절한다.
host crash·sleep·wake 뒤에도 유효한 Grant 확인 전 새 효과를 시작하지 않는다. stop 신호·watchdog 감지만으로 이 조건을 충족하지 않는다.
그 승인 연결·hook·control 설정도 Worker가 바꿀 수 없게 보호한다. 단순 policy-changed 메시지나 늦은 결과 무시는 효과 차단이 아니다.
요구한 경계를 해당 버전이 집행하지 못하면 무인 실행 후보에서 제외하고 감독되는 사용만 허용한다.
첫 model API 경로는 호스트가 `list_files`, `read_file`, `write_file`만 실행하고 매 호출을 검증한다. 모델에 shell·임의 네트워크 도구를 노출하지 않는다.
임의 shell을 허용하면 Git 명령 필터만으로 외부 전송을 막을 수 없다. 무인 실행은 가능한 OS·환경·credential 제한을 함께 검증한다.
소스 읽기와 편집 권한을 줬다는 이유로 push·외부 게시·credential 변경을 허용하지 않는다.
격리가 부족하면 Ariadne의 자동 쓰기·효과 실행을 차단하고 관측·수동 handoff만 제공한다.
사용자는 해당 native UI에서 그 도구의 실제 승인 범위로 작업할 수 있다. 화면이 보인다는 이유로 승인·격리가 충족됐다고 보고하지 않는다.

예산은 시간·시도·동시 실행·관측 가능한 usage를 각각 기록한다. cache token과 output·reasoning의 중복 합산을 피한다.
native 구독 quota나 일부 token이 관측되지 않으면 `unknown`으로 남긴다. 관측 불가능한 금액의 하드 상한을 보장한다고 표시하지 않는다.
API 유료 실행은 비용 정책·승인 없이는 활성화하지 않는다. 자동 배정·재시도·검토·Router 호출도 총사용량에 포함한다.
실행을 중지해도 이미 접수된 공급자 비용이 취소됐다고 추정하지 않는다.

### 11.1 한 번 승인한 작업 예산을 나눠 쓴다

[작업 전체 승인 정책](execution-policy.md#작업-예산과-승인을-나누면)을 Grant와 하나의 Task ledger로 집행한다.
구현·독립 검토·재시도·자동 전환·필요한 LLM 라우팅·child의 사용량은 같은 Task에 귀속한다.
run·generation·재시작·selection revision이 ledger를 초기화하지 않는다. 예산을 늘리는 작업은 새 명시 승인을 요구한다.
전역·executor·Task·Grant·run별 제한은 모두 동시에 만족해야 한다. 하위 run 한도는 상위 제한을 늘릴 수 없다.
명시한 시간 deadline은 보존하고 재시작으로 연장하지 않는다. 실제 모델·도구 실행 시간과 대기 시간은 별도 관측값으로 남긴다.
시간·시도·동시성의 필수 한도와 유효한 승인 없이 자동 실행하지 않는다. 이번 문서는 금액·시간·시도 횟수를 임의로 승인하지 않는다.

dispatcher는 한 트랜잭션에서 Task revision·generation·policy revision·selection revision·source와 한도·후보를 대조한다.
동일 트랜잭션에서 슬롯·workspace claim·필요한 예산 예약을 함께 반영한다.
하나라도 충족하지 못하면 아무 run도 발사하지 않는다. 병렬 run이 각각 같은 잔여 예산을 전부 사용할 수 없도록 예약액을 차감한다.
승인 뒤 실제 발사 전에도 철회·세대 변경을 대조한다. 예약 취소는 미접수·미실행을 확인한 경우만 허용한다.
접수 여부·사용량이 unknown이면 예약을 유지하고 재조회한다. terminal 관측과 정산 근거 없이 금액을 0으로 돌리지 않는다.
호출의 최대 비용을 보수적으로 예약하거나 공급자 측 하드 한도를 확인할 수 없으면 엄격한 금액 상한 모드에서는 dispatch를 거절한다.
native 구독은 금액 보장이 가능한 것처럼 표시하지 않고 관측 가능한 시간·시도·슬롯과 해당 사용 정책을 적용한다.

목표 정책상 역할별 새 승인은 필요 없지만, 위험 action의 별도 승인·tool 권한·sandbox 조건은 유지한다.
예산이 남아도 재현 근거 없는 같은 실패를 반복하지 않으며, 품질 하한을 낮춰 완료 처리하지 않는다.
한도가 소진되면 새 효과를 차단하고 진행 상태·정산 상태·늘려야 할 범위를 남긴다. 이미 접수된 효과는 취소됐다고 추정하지 않는다.

### 11.2 승인·자료 반출·실제 효과의 책임을 분리한다

`REQ/AGENTS`는 의도와 제약, `Grant`는 현재 허가, host guard는 실제 접수/거절을 소유한다.
API 인증 원문은 모델 payload·handoff·로그·receipt에 넣지 않고 host가 승인한 endpoint로 보내는 transport Authorization header에만 주입한다. 이것은 모델에 credential 읽기 권한을 주는 동작이 아니다. 승인에는 endpoint·계정 참조·credential identity를 묶고 매 호출 대조한다. 키·계정·endpoint 변경은 재승인 전 거절하며 identity 비교용 내부 값도 모델에 보내지 않는다.
파일 도구는 canonical path·symlink·지침/credential/control 파일·현재 source·예산을 검사한다. controller 코드·승인 hook·설정도 worker 쓰기 범위 밖에 있어야 한다.
CI는 해당 커밋의 병합 조건이고 도구/OS 경계는 실행 중 효과를 제한한다. 필수 status check·신뢰하는 체크 발행자·우회 권한을 확인하지 않은 CI 존재만으로 집행을 주장하지 않는다.

전송 소유자는 `preparePacket(taskId, destination)` 한 경계에서 허용 필드 선택 → 구조화 전체 비밀 제거 → 직렬화 → 필수성/전체 예산 검사를 수행한다.
context 문자열뿐 아니라 AC, event, tool 결과, 선택한 로그·handoff와 후속 messages의 중첩 key/value를 모두 검사한다. 정제 후 key 충돌·스키마 손상은 거절한다. auth 원문·control DB 내부 레코드·다른 프로젝트 payload는 넣지 않는다.
raw REQ의 `contract_hash`와 실제 전송한 `payload_hash`는 구분하고, 정제한 내용을 새 AC 원본이나 새 실행 승인으로 역수입하지 않는다.
최종 직렬화의 escaping·wrapper를 포함해 기존 UTF-16 문맥 예산을 검사하고 transport의 byte 상한도 별도로 지킨다. 필수 의미를 보존할 수 없는 비밀 제거·금지 데이터·예산 초과는 전송 거절이며 선택 필드의 생략과 구분한다. 탐지되지 않은 비밀까지 차단한다고 보장하지 않는다.
패킷 구성·검증을 실행 예약/외부 접수 전에 끝내고, 예약 직후 실제 전송 직전에도 현재 Grant·epoch·source·목적 endpoint/계정 참조를 대조한다.
이미 예약한 뒤 준비/접수 전 오류가 나면 미접수를 확인해 예약을 해제하고 blocked로 남긴다. 접수 여부를 모르면 unknown을 유지한다. 어느 오류도 관측되지 않은 Promise 거절로 dispatcher를 종료시키지 않는다.

### 11.3 Git 공개 경계도 별도로 검사한다

`.gitignore`는 새 파일의 실수 추적을 줄이는 예방책이며 이미 추적한 파일·과거 commit·임의 소스에 들어간 키를 제거하지 않는다.
현재 세 checkout의 ignore는 handoff·node_modules·로그뿐이다. 공개 checkpoint의 추적 파일 검사에서 실제 credential 파일은 발견하지 못했고 패턴 일치는 개별 검토한 합성 fixture뿐이었다.
이것은 전면 비밀 부재의 증명이 아니다. 이번 문서 변경은 ignore 설정이나 원격 저장소를 바꾸지 않는다.

후속 설정 단위는 `.env`/환경별 실제 값, credential·private key 파일/전용 디렉터리, 프로젝트 runtime DB·journal·WAL/SHM을 기본 제외한다.
비밀 없는 `.env.example` 같은 배포 템플릿은 개별 예외로 유지하고 코드·정당한 fixture까지 광범위하게 숨기지 않는다.
경계 검사는 `git check-ignore`의 새/중첩 경로 사례, 실제 `git ls-files`와 staged diff, 게시할 ref/commit 이력의 탐지 결과를 함께 사용한다.
테스트 폴더 전체를 예외 처리하지 않으며 각 탐지값의 합성 여부를 분류한다. 실제 값·판단 불가 값은 게시를 거절하고 로그에는 값 대신 경로·범주만 남긴다.
이미 추적한 민감 파일은 소유자 확인 없이 삭제하지 않는다. 실제 노출은 ignore만으로 해결하지 않고 해당 credential의 폐기/교체와 필요한 이력 조치를 별도 명시 승인으로 처리한다.
GitHub push protection을 우회하지 않는다. 예방 설정·사전 검사·원격 차단을 각각의 방어로 유지한다.

## 12. 이벤트와 watchdog는 같은 작업 관리 위에 추가한다

외부 입력은 project·source·repository·author 허용 범위를 먼저 검사한다.
이벤트 중복 키는 provider event ID를 우선하고 CI의 run ID·run attempt·상태 전이를 보존한다.
같은 PR의 재실행이나 다른 결론을 첫 실패와 합쳐 버리지 않는다. 순서 역전은 source revision·run attempt로 대조한다.
Thread는 프로젝트·source·저장소를 포함한 key로 구분하고 task와 연결한다.
한 task가 관련 thread 여러 개를 구독할 수 있지만, 초기에는 workspace의 쓰기 owner 하나를 유지한다.
관련 thread의 문맥 구독은 새 작업 시작이나 완료 작업 재개의 권한이 아니다.

새 외부 입력은 확정된 [후속 처리 정책](execution-policy.md#새-요청이나-외부-이벤트가-들어오면)에 따라 먼저 관측한다.
새 작업 접수 경로는 기본 `admission_mode: observe`다. 이 경로는 후보만 기록하고 모델 호출·도구 효과를 시작하지 않는다.
이미 맡긴 미완료 Task의 후속 전달은 별도 경로이며, 그 Task의 현재 Grant가 후속 처리를 허용할 때만 실행한다.
문맥 구독만으로 Grant를 대신하지 않는다. 중지·완료·승인 대기·unknown Task를 이벤트가 임의로 깨우지 않는다.
전체 처리 중지와 새 작업 접수 모드를 혼동하지 않는다. 전체 중지 fence가 있으면 기존 Task의 자동 후속 처리도 시작하지 않는다.
DeepSeek 공개판의 observe와 의미가 같다고 가정하지 않는다. 새 작업 자동 접수는 프로젝트별 조건·실행 Grant를 명시한 뒤에만 활성화한다.
새 이벤트는 inbox에 보존하고 안정된 구독은 Worker에 직접 전달한다. 새 배정이 필요한 사건만 Router가 판단한다.
batch는 큐에 이미 쌓인 입력을 크기·지연 예산 안에서 묶는다. 최초부터 LLM 상시 Router·여러 Router shard는 만들지 않는다.
외부 댓글·PR·메시지 작성은 승인된 outbox를 통해서만 실행하며 수신 이벤트가 외부 발송 승인으로 바뀌지 않는다.

watchdog는 주 실행기 밖의 결정론 관측부터 시작한다. process 생존·마지막 관측과 실제 source·검증 진전을 구분한다.
unknown 실행은 재조회하고, 명시적 중지는 그대로 둔다. 지연만으로 새 worker를 띄우지 않는다.
watchdog가 프롬프트·권한·모델 설정을 스스로 바꾸거나 실패한 정책을 완화하지 않는다.
의미적 방향 이탈 검토가 필요하면 별도 예산·읽기 전용 run으로 추가한다. 정기 LLM 호출을 기본으로 두지 않는다.
Mac이 잠들면 실행·감시도 중단될 수 있다. 클라우드 compute·원격 daemon·기기 간 credential 동기화는 후속 독립 설계다.

### 12.1 실패 분류와 진전 근거로 재시도를 판정한다

`Run`은 실제 실행 결과, `Effect`는 외부 부작용의 intent·접수·결과를 소유한다. 같은 idempotency key의 다른 인자는 오류이며, 결과 불명확은 실패로 바꾸어 재실행하지 않는다.
재시도 중복 방지와 동시성/호출 빈도/대기 제한을 별도 책임으로 유지한다. 아래는 현재 승인·잔여 Task 예산 안에서만 적용한다.

| 관측한 원인 | 다음 행동 |
| --- | --- |
| 인자·선행 입력 오류 | 해당 입력을 실제로 바꾸고 관련 범위 검사. 문구만 바꾼 동일 요청은 새 근거가 아님 |
| 테스트 실패 | 실패한 요구/구현/fixture를 확인하고 최소 수정. 잘못된 테스트 정정은 이유를 기록하며 통과를 위한 약화·skip은 거절 |
| 권한·승인 거절 | 필요한 주체의 현재 승인/권한 변경 전 재실행하지 않음 |
| 공급자의 확정된 사용량 제한·장애 | 해당 API의 접수·재시도 계약과 Retry-After/대기 정책을 확인. 종료·효과 확인 뒤 허용 후보로 전환하거나 제한된 재시도 |
| timeout·응답/접수 유실 | 기존 handle·effect부터 대조. 멱등성 키가 있어도 모호한 결과를 성공/무료로 추정하지 않음 |

시도마다 `failure_kind + check/effect key + normalized error code + input/source/config identity`를 기록한다. 비밀·전체 stderr를 fingerprint 원문에 저장하지 않는다.
진전은 관련 입력·소스·설정의 실제 변경이나 새 원인/관측 근거다. 요약 재작성·run ID·새 Grant ID·재시작만으로 카운터를 초기화하지 않는다.
독립 transient 요청의 승인된 backoff 재시도와 무변경 코드 실패의 반복을 구분한다. 일시 오류 재조회까지 동일 오류 문자열만으로 금지하지 않는다.
기존 REQ의 `escalate_after`와 Task의 시간·시도·호출·비용 정책이 모두 상한이며 문서에서 3회를 새 절대값으로 복제하지 않는다.
실패/attempt 기록에는 원인·실제로 바꾼 입력·관련 check와 다음 관측을 남긴다. 전역 대화 수집기나 별도 학습 daemon은 추가하지 않는다.

## 13. 구현 단위와 인수 시나리오

아래는 구현 계획이며 완료 결과가 아니다. 각 단계는 별도 REQ·로컬 커밋·필수 게이트·정리 근거로 끝낸다.
실제 유료 smoke·외부 작업은 승인된 범위에서만 실행한다. 테스트 대역 통과를 실제 계정·구독 호환성으로 승격하지 않는다.

| 순서 | 변경 경계 | 다음 단계로 넘기는 기준 |
| --- | --- | --- |
| A0 문맥·검증 계약 | `lib/context-pack.mjs`, context·handoff·route 원본, REQ 템플릿·관련 tests·설치 명시 목록·생성 미러 | verification·확정 사실을 잃지 않고 REQ ID·상태·필수 예산을 검증. 기존 verify 환경 위험은 먼저 실패 재현 |
| A1 수동 연속성 | 코어 파일 기반 receipt·source 대조·수동 효과 기록, 실제 설치 대상과 focused tests | 실행기 없는 상태에서도 근거 재사용·미확정 효과 차단·재개 패킷을 검증. 신규 봉인만 적용 |
| A2 로컬 실행 관리 | 선택 `modules/loop/`, SQLite 상태·등록·공통 adapter 계약·task 상태·workspace 소유권 | 가짜 adapter로 시작·관측·취소·crash·late result를 검증. 공급자 없이도 결정론 검사가 성립 |
| A3 native 세로 구현 | Codex, Claude Code, Gemini를 독립 adapter로 순차 qualification | 각 adapter 단독 구성으로 start·관측·권한·정리·재개를 검증. 다른 제품 설치를 요구하지 않음 |
| A4 API 세로 구현 | 최소 제한 tool loop와 공급자 하나의 API adapter. Grok은 후보이며 API 승인 후 연결 | API 실행기 하나만으로 동일 task·receipt 계약 충족. native agent나 글로벌 CLI 로그인 필수 아님 |
| A5 실행 풀·전환 | 기능 기반 배정·명시 지정·role별 run·안전한 handoff·한도 | 단일 도구와 복수 도구 시나리오 모두 통과. 혼합 실행·전환 시 소유권·승인·근거 유지 |
| A6 이벤트·관측 | inbox·thread binding·direct delivery·outbox·결정론 watchdog | 먼저 로컬 replay·observe, 다음 read-only live source. 중복·역전·재시작·수동 중지 검사 후 자동 실행 별도 활성화 |

공통 제어는 확정한 기존 도구 화면·공통 CLI 정책에 따라 프로젝트 스킬에서 호출 가능한 로컬 CLI로 구현한다.
API만 쓰는 구성은 이 CLI가 시작점이 된다. 기존 native UI의 진행 중 세션을 임의로 탈취하거나 모든 입력을 자동 가로채지 않는다.
Task 목록·status·resume·stop·executor 지정의 정확한 명령은 A2에서 확정한다. 이 문서의 이름은 현재 실행 가능한 명령이 아니다.
Gemini용 지침 연결은 실제 지원 파일·skills 로딩 계약을 확인한 뒤 생성 원본에 추가한다. Codex·Claude wrapper를 그대로 읽는다고 가정하지 않는다.
raw model API에는 호스트가 공통 규칙과 task 패킷을 주입한다. API가 AGENTS.md를 저절로 읽는다고 가정하지 않는다.

### 13.1 정책에서 검증까지 추적한다

정책 원문은 [작업 실행 정책](execution-policy.md)에만 둔다. 아래 고정 ID는 개발·인계용 연결이다.
아래 시나리오는 목표 판정이다. 일부 helper/초안 테스트의 통과를 전체 계약의 qualification으로 승격하지 않는다. 이번 보완의 제품 검증은 아직 실행하지 않았다.
기존 결정·검증 근거는 보존하고, 이 후속 변경의 근거·이전 결과·적용 범위는 [정책 REQ](../.harness/reqs/unified-execution-policy.yaml)가 소유한다.

| 결정 | 정책 소유 절 | 설계·구현 책임 | 인수 시나리오 |
| --- | --- | --- | --- |
| UEP-01 | 어디에서 작업을 시작하는가 | §3·4와 A2 CLI·A3·4 adapter | UES-UI, UES-SINGLE |
| UEP-02 | 새 요청이나 외부 이벤트가 들어오면 | §12 inbox·접수와 Task 후속 전달 경계 | UES-EVENT |
| UEP-03 | 실행기를 고르거나 바꾸면 | §5 기능·역할별 품질·현재 가용성 | UES-ROUTE |
| UEP-04 | Mac이나 Ariadne를 다시 켜면 | §7 시작 대조·§8 자동 재개·§9 unknown | UES-RESUME |
| UEP-05 | 실행기를 고르거나 바꾸면 | §5 selection origin·§6 소유권 이전 | UES-FAILOVER |
| UEP-06 | 여러 실행을 함께 진행하면 | §9 전역·executor 슬롯·child와 writer claim | UES-SLOTS |
| UEP-07 | 작업 예산과 승인을 나누면 | §11.1 Task ledger·상위 한도·원자적 예약 | UES-BUDGET, UES-RESERVATION |

| 시나리오 | 통과 판정 |
| --- | --- |
| UES-UI 기존 도구 화면·API 단독 사용자 | 공통 CLI에서 목록·재개·중지·지정을 수행. API 단독 구성에 native UI 설치를 요구하지 않으며 진행 중 native 대화를 임의 제어하지 않음 |
| UES-SINGLE Codex만·Claude만·Gemini만·Grok API만 구성 | 선택한 adapter가 qualification을 통과하면 다른 도구 없이 동일 작업 절차 사용. 미검증 adapter는 이유와 함께 실행 차단 |
| UES-EVENT 새 CI 이벤트와 맡긴 Task의 후속 | 새 이벤트는 observe 후보만 기록하고 모델 호출·새 Task 실행 없음. 기존 Task의 허용된 후속만 현재 Grant·예산으로 실행하며 중지·완료·미확정 상태는 깨우지 않음 |
| UES-ROUTE 둘 이상 등록 후 자동 배정·명시 지정 | 품질·필수 기능·권한·예산을 충족한 후보만 비교. 빠르거나 저렴해도 품질 미달 후보는 제외. 사용자 지정 우선이며 근거 없는 품질·usage 점수를 만들지 않음 |
| UES-RESUME crash 뒤 실행 중·종료·사용자 중지·미확정 작업 | 실행 중은 기존 handle 관측, 종료와 효과가 확인된 미완료 작업만 현재 source·Grant·잔여 예산으로 재개. 중지·만료·unknown·승인 대기는 자동 실행하지 않음 |
| UES-FAILOVER 자동 배정·명시 지정의 quota 거절 | 자동 배정만 종료·효과 확인 뒤 허용 후보로 전환. 명시 지정은 대기. source·데이터 범위·승인·원래 Task 예산을 유지하고 미승인 유료 경로로 넘어가지 않음 |
| UES-SLOTS 독립 실행 2개·추가 child·같은 공간 writer | 최대 2개와 더 낮은 executor 한도를 모두 만족. 세 번째 실행은 대기하고 같은 workspace writer는 하나. unknown은 점유 유지. 부모 claim과 충돌하는 쓰기 child는 거절하고 부모는 미시작 child를 기다리지 않음. suspend된 부모는 현재 승인·예산·슬롯 재획득 뒤 재개 |
| UES-BUDGET 한 번 승인 후 구현·검토·재시도·전환 | 추가 역할 승인은 묻지 않되 같은 Task에 모두 계상. 재시작·전환에도 한도 초기화 없음. 한도 소진·권한 확대·새 유료 경로는 해당 실행을 중지하고 확인 |
| UES-RESERVATION 병렬 두 실행의 마지막 예산·접수 응답 유실 | 슬롯·claim·예산을 함께 예약하여 잔액 초과 중복 배정 거절. 접수·usage unknown이면 예약 유지·재조회. 실제 소비·정산 없이 잔액을 복원하지 않음 |
| Codex 수정 뒤 Claude로 인수인계 | 종료·효과 확인 후 같은 Task의 새 run 생성. 목표·실패·검증 근거 보존. 이전 run은 새 상태를 덮지 못함 |
| 같은 CI 이벤트 두 번·중간 재시작 | 동일 task·delivery로 수렴. 외부 효과 결과는 재조회하며 중복 발사하지 않음 |
| CI 재실행·순서 역전 | 다른 run attempt를 보존하고 오래된 성공이 현재 실패를 지우지 않음 |
| intent 저장 직후·외부 접수 직후 crash | unknown으로 복구. 기존 handle·효과 확인 전 재실행·완료·writer 이전 차단 |
| 실행 중 방향 변경·정책 철회·늦은 완료 | revision·generation·policy 대조로 현재 상태 반영 차단. 승인된 새 방향만 재개 |
| Worker가 control DB·등록·승인 hook 변경 시도 | 직접 쓰기·shell 우회·설정 변경을 기계적으로 차단. 차단 불가 adapter는 무인 실행에서 제외 |
| dispatcher 중복 기동·unknown run을 둔 재시작 | 호스트 dispatcher 하나만 쓰기. 기존 run 확인 전 전역 슬롯·workspace claim 재발급 금지 |
| native resume의 모델·sandbox·승인 설정 불일치 | 실제 설정 일치 확인 전 resume 거절. 새 run에서도 현재 정책·기능을 재검사 |
| 실행 중 승인 철회·승인 host 단절 | 후속 효과를 차단하고 같은 handle로 중지·결과 조회. 이미 접수된 효과는 별도 확인 |
| 사용자가 stop 후 앱·Mac 재시작 | 중지 기록을 유지하고 자동 재개하지 않음. 취소 요청만으로 child 종료나 비용 취소를 주장하지 않음 |
| 같은 HEAD의 dirty·untracked·설정 변경 | 영향을 받는 receipt 재사용 거절. 같은 내용의 새 커밋은 명시 동등성 검사로 처리 |
| AC 근거 누락·변경·nonzero·unknown·깨진 참조 | 완료 봉인 거절. 정상 packet과 사람 관측의 별도 긍정 사례도 통과 |
| thread 문맥·bot 댓글·다른 프로젝트 참조 | 권한 확대·자동 재개·프로젝트 간 조회를 거절. 승인 없는 외부 outbox는 실행하지 않음 |
| 실패·timeout·취소 후 cleanup | 소유 child 종료 확인 후 task-owned 임시 자원만 정리. 공유 cache·사용자 변경은 보존 |

효과 평가는 같은 작업의 정답·회귀, 완료 시간, 전체 호출·usage·cache, 재시도, 사람 개입 횟수를 함께 기록한다.
합성 스케줄링 결과를 코딩 품질이나 실제 구독 절감률로 바꾸지 않는다. 기존 instrument controls는 장치 자가검증일 뿐이다.
숫자 성능 기준은 baseline 측정 뒤 구현 REQ에서 고정한다. 이 설계에 임의 절감률이나 처리량 약속을 넣지 않는다.

### 13.2 이번 집행 보완의 인수 기준과 순서

| 고정 ID | 정상 사례와 반드시 거절할 사례 | 다음 구현에서 확인할 경계 |
| --- | --- | --- |
| UES-COMPLETE-LATEST | 모든 최신 check 통과는 봉인. 성공 뒤 실패/pending/unknown/결과 누락은 과거 성공·UUID 순서와 관계없이 거절 | verification·store·runtime·status |
| UES-POSTCOMPLETE-CHECK | 완료 뒤 같은 revision의 명시 재검증 실패/진행 중은 state=completed, receiptValid=false와 blocker. 새 이벤트·restart가 AI를 재개하지 않으며 새 수정은 명시 revision/승인 필요 | Task state·공통 판정·event/recovery |
| UES-GATE-COVERAGE | 중복인 동일 명령은 한 실행으로 모든 참조를 충족. AC만 통과하고 별도 필수 gate가 빠지면 거절. gate 비필수 표기를 몰래 필수/면제로 바꾸지 않음 | canonical REQ plan·관련 fixture |
| UES-CHECK-FINALIZE | 명령 exit 뒤 로그 flush/수집을 지연해도 완료 불가. 시작/봉인 요청의 두 순서를 모두 대조 | check 예약·artifact 원자적 교체·최종 DB commit |
| UES-CHECK-SCOPE | 같은 소스·명령·관측 가능한 환경은 재사용. dirty·untracked·mode·의존성/설정·필요 Git 이력 변경과 수집 불가는 거절 | source·scope 관측·후보 선택 순서 |
| UES-PACKET-BOUNDARY | AC·event의 중첩 key/value·오류·tool 결과·후속 messages까지 정제. control 비밀·다른 프로젝트 자료·정제 후 key 충돌은 거절 | 최종 DTO·API·native handoff·CLI packet |
| UES-TRANSPORT-AUTH | 승인한 호출은 key가 transport header에만 존재. payload/log/receipt에 값 없음. key/계정/endpoint 교체 뒤에는 재승인 전 호출 거절 | Grant identity·API transport·최종 packet |
| UES-PREPARE-FAILURE | 필수 패킷 초과/정제 실패는 provider 호출·새 예약/사용량 없이 blocked. 접수 여부 불명확이면 unknown | prepare/예약/접수 순서·예외 수집 |
| UES-OWNER-RECOVERY | 실제 두 프로세스 중 owner 하나만 획득. 살아 있는 owner·동시 복구·죽은 PID 오판에서 새 lock/socket 삭제 금지 | SQLite owner 연결·server 수명 |
| UES-OWNER-FENCE | 이전 epoch의 늦은 결과·정리가 새 owner 상태를 바꾸지 않음. crash 뒤 unknown 슬롯/claim/예산 유지 | admission·결과·cleanup fence |
| UES-RETRY-PROGRESS | 관련 입력 수정은 허용. 동일 결정론 실패와 이름만 바꾼 재시도는 거절. 허용된 transient 재조회와 미확정 효과 replay를 구별 | failure 분류·REQ attempts·Task ledger |
| UES-GIT-SECRETS | 새/중첩 비밀 경로는 ignore, 비밀 없는 예제는 유지. 추적/과거 commit의 실제 키는 ignore와 무관하게 게시 차단 | ignore 설정·staged/ref 검사·fixture 분류 |
| UES-LEGACY-UPGRADE | 새 관측은 새 봉인 생성. 과거 verified/receipt 자동 인증·승인/예산 초기화·구버전 쓰기는 거절. 구 PID protocol 생존/불명확이면 전환을 차단하며 offline 확인 후 이전. 중간 실패는 복구 가능 | schema 전환·일관 백업·legacy 조회 |

각 사례는 우선 의도한 동작의 실패 테스트로 고정한 뒤 관련 기존 tests에 통합한다. 기존 전체 게이트와 함께 통과해야 해당 단위가 끝난다.
실행 범위는 `contract`, `store`, `runtime`, `server`, `api`, `native`, context·scrub 및 CLI 호출부/fixture까지 추적하며 범위 밖의 테스트 묶음을 만들지 않는다.

| 단위 | 구현·검증할 내용 | 통과해도 아직 허용되지 않는 것 |
| --- | --- | --- |
| E1 완료 판정 | 필요한 plan/scope/시작 순번과 최신 결과·필수 gate, 수집 종료 fence, status의 같은 판정 | E1만으로 dispatcher·무인 실행 공개 |
| E2 반출 경계 | 최종 전체 패킷과 후속 messages의 허용 필드·비밀 제거·필수 예산·접수 전 실패 정산 | 새로운 공급자·과금·native 권한 활성화 |
| E3 복구 경계 | owner 연결과 epoch, real process 경합/crash, schema 백업/이전과 legacy 보존 | 알려지지 않은 filesystem·기존 native 효과 자동 종료 추정 |
| E4 재시도·통합 | 오류 분류·변경 근거·동일 예산, 별도 ignore/공개 전 설정 단위와 모든 반례, 실제 CLI 성공/거절/정리 | 합성 서버 검사만으로 실제 유료 공급자·장기 운영 qualification |

E1은 고립된 저장소 테스트부터 시작한다. 제품 DB의 변경은 E3의 owner·백업 조건을 충족한 뒤 수행하며 E1~E4를 따로 검증/커밋한다.
테스트는 자기 임시 디렉터리·프로세스·DB·socket·artifact만 만들고 종료/정리한다. 재현에 필요한 작은 근거는 기존 handoff 경로에 보존한다.

## 14. Atlas와 Super-agent에서 채택한 것과 보류한 것

Atlas는 2026-11-02 로컬 clean 소스의 고정 revision을 읽었다. 테스트 assertion을 확인했으며 제품 테스트는 실행하지 않았다.
runtime은 `609a1a6bb880686a408d0aaee972f254d94d7b47`, app은 `54ceeccc5e5b536361496cb1fc309199f12c35f6`이다.
기존 적용 목록은 [atlas-transfer](atlas-transfer.md)를 원본으로 유지한다. 이 표는 새 설계로 확장하는 지점이다.

| 근거 | 이번 설계의 적용 | 한계 |
| --- | --- | --- |
| runtime `internal/goal/goal.go:334`, `goal_test.go:43` | 변경하지 않은 AC와 AC별 실제 근거를 완료 조건으로 결합 | 현재 Ariadne verify에는 REQ 완료 자동 검사가 없음. 실제 허위 완료 사고를 재현한 것은 아님 |
| runtime `internal/checkpoint/plan.go:48`, `apply.go:86`, `checkpoint_test.go:274` | source receipt·현재 상태 재확인·사용자 변경 보호 | checkpoint 복원 엔진을 복제하지 않음 |
| runtime `internal/turnrun/run.go:128`, `run_test.go:250` | 재시도에도 시도·시간·usage 예산 소비 | 무진행 카운터 숫자나 threshold를 검증 없이 복제하지 않음 |
| runtime `internal/toolrun/run.go:163`, `internal/store/lifecycle.go:227` | intent-before-effect·unknown 복구·재조회 후 다음 실행 | 로컬 수동 기록은 외부 효과와 원자적으로 결합하지 않음 |
| app `src/lib/runtime/conversation-controller.ts:154`, `tests/workspace.test.mjs:45` | 동일 request ID·입력의 접수 재조회, generation으로 늦은 결과 제한 | 프로세스 내 pending Map을 재시작 내구성으로 확대하지 않음 |
| app `src-tauri/src/runtime.rs:246`, `runtime_tests.rs:154` | 좁은 입력·operation·경로 경계, 실제 기능별 qualification | SSE reconnect·dedup·auth epoch 집행을 이미 완성된 기능으로 가정하지 않음 |
| 제공된 Super-agent 원문 §2~4 | Router·Worker 역할 분리, deterministic filtering·직통, inline·spill, 비동기 관측 | 로그인된 모든 도구 동시 발사·상시 LLM Router를 요구하지 않음 |
| 제공된 원문 §5~6·§8 | 상태와 실행 환경 구분, 외부 관측 루프, 프로젝트·권한 경계 | cloud·BYOM daemon·A2A·watchdog의 정책 자동 수정은 보류 |
| 제공된 원문 §7 | 사람의 관리 비용과 token 증가의 tradeoff를 함께 측정 | sleep tool을 쓴 합성 실험이며 실제 코딩 품질·Codex 절감률의 근거가 아님 |

현재 코드에서 verification 문맥 누락·REQ ID와 status 미검증·완료 봉인 부재를 정적으로 확인했다.
`NODE_TEST_CONTEXT`가 production verify 자식의 실행을 억제할 가능성은 미재현 위험이다. A0에서 실제 실패를 재현한 경우에만 수정한다.
이 설계를 이유로 제품 보안·API·전 저장소 감사가 완료됐다고 보고하지 않는다.

## 15. 실패 근거로 규칙을 만들고 효과가 없는 복잡성을 줄인다

사용자가 제공한 Reddit 스크린샷의 핵심은 작은 하네스를 실제 실패·평가·정리의 반복으로 유지하는 것이다.
이를 실행 풀의 운영 규칙으로 채택한다. 단순히 규칙·도구·agent 수를 늘리는 것을 개선으로 판정하지 않는다.

| 이미지의 제안 | Ariadne의 설계 계약 | 확인할 근거 |
| --- | --- | --- |
| 과거 세션의 실패를 규칙 후보로 사용 | 사용자 정정·실패 gate에서 원인과 최소 재현만 기존 REQ·decision에 연결. 원문 세션·비밀을 전역 수집하지 않음 | 실제 입력에서 실패하는 사례와 방지해야 할 동작 |
| 도움을 입증하지 못한 규칙 정리 | 후보를 자동 승격하지 않음. 비보안 편의 규칙은 비교 근거에 따라 축소·제거 후보로 만들고 현재 적용본을 버전으로 특정 | 같은 작업·판정의 규칙 전후 비교와 반례. 작은 표본의 무효과를 효과 없음으로 단정하지 않음 |
| 짧은 지침 파일 | AGENTS는 공통 경계와 문서·명령의 길 안내를 담당. 상세 실행기 설명·history·긴 plan은 필요한 때 조회 | 기존 `CORE_LINE_CAP = 150`과 mirror 검사 재사용. 사례의 약 100줄을 새 절대 기준으로 복제하지 않음 |
| 적고 구별되는 도구 | 공통 task 제어와 필요한 실행기 기능만 노출. 공급자별 도구 목록 전체를 매번 주입하지 않음 | 잘못 고른 도구·인자 오류·중복 기능·중간 출력량의 실제 사례 |
| 중요한 규칙을 코드로 집행 | 승인·source 대조·workspace 소유권·완료·중복·예산은 신뢰 경계의 결정론 검사. 프롬프트는 의도와 설명 담당 | 각 불변식의 실패 사례와 정상 사례. 필요한 보안·권한·무결성 검사는 유지 |
| 문서와 규칙을 정기적으로 정리 | adapter·명령·schema 변경 때 관련 owner 문서·미러·source 링크 확인. 먼저 작은 로컬 수정 후보를 만들고 검토 | 오래된 명령·불일치 미러·없어진 경로·중복 설명. 외부 PR 자동 게시나 전역 정책 자동 수정은 하지 않음 |

규칙 변경은 `실패 근거 → 원인·후보 → 가장 작은 가드 → 관련 사례 재검증 → 유지·축소·철회` 순서다.
새 rule registry나 별도 학습 daemon을 만들지 않고 기존 REQ·decision·회귀검사·문서 원본을 사용한다.
희귀하게 발동했다는 이유로 보안·credential·권한·무결성·외부 계약 검사를 삭제하지 않는다.
문서 gardening과 watchdog의 역할도 분리한다. 문서가 오래됐다는 관측은 실행 중 권한을 바꾸는 명령이 아니다.

이 설계의 작은 첫 검증은 verification 문맥 누락이다. 실패·검사 명령이 재개 팩에서 사라지는 사례를 먼저 고정하고,
필수 필드 보존으로 해결한 뒤 기존 팩 예산과 비밀 제거가 유지되는지 확인한다. 이를 위해 새 LLM Router를 만들 필요는 없다.
A0~A1은 이 원칙을 검증하고, A2 이후 각 단계도 추가한 구성요소의 효과와 유지 비용을 함께 검토한다.

[OpenAI의 하네스 사례](https://openai.com/index/harness-engineering/)는 짧은 AGENTS와 상세 문서의 분리,
기계적 제약 검사·문서 정리의 근거로 사용한다.
[Anthropic의 도구 설계 글](https://www.anthropic.com/research/writing-tools-for-agents)은 겹치지 않는 도구와 실제 결과 중심 평가의 근거다.
스크린샷의 Stanford 6배·57편·보안 규칙 4~16%·도구 축소 수치는 연결된 원논문·사례를 특정하지 못했으므로 검증된 수치로 채택하지 않는다.
다른 팀의 결과를 Ariadne의 성능·비용 약속으로 옮기지도 않는다.

### 15.1 이번 설계의 선택과 수용한 비용

문제는 새 에이전트 수가 아니라 완료/재개 근거를 잘못 선택하거나 집행 경계가 우회되는 것이다. 두 구조를 비교했다.

| 대안 | 숨기는 복잡성과 새 책임 | 판단 |
| --- | --- | --- |
| A: 기존 Task/Run + 직접 CheckAttempt/Result 조회 | 작은 `check/complete/status` 뒤에 순서·필수 검사·scope·봉인 판정을 모음. 단조 시작 순번과 insert-only 결과가 필요 | 현재 규모의 기준안. 전체 상태 모델 교체 없이 결함을 닫음 |
| B: 모든 상태를 append-only event log + reducer로 재구성 | 전체 전이의 재생·감사를 제공하지만 event version·projection·replay의 정합성도 소유해야 함 | 현 요구에 전체 재구성이 필요하지 않아 보류. event bus나 학습 daemon도 추가하지 않음 |

A를 기준으로 B가 강조한 `CheckStarted` 우선 기록과 접수 사실/외부 효과의 비원자성을 반영했다.
CheckAttempt는 시작 순번·입력 identity를 보존하고 Result는 같은 attempt에 한 번만 기록한다. unknown 대조는 run 예약 해제를 허용할 수 있으나 과거 결과를 passed로 덮지 않으며 새 검증으로 봉인한다.
owner DB 하나를 추가하는 비용으로 상태 DB의 짧은 durable commit과 프로세스 수명 잠금을 분리한다. PID 재사용/시간 만료를 소유권 증거로 사용하는 대안은 제외했다.
외부 editor·같은 OS 사용자의 임의 변경까지 막지 못하는 대신 독점 worktree와 검증된 입력 범위를 전제로 한다. 의미 검토와 사람 승인은 해시/테스트로 대체하지 않는다.
기존 REQ/컨텍스트/미러를 재사용하며 `STATE.md`·두 번째 AC 목록·새 정책 registry를 자동 추가하지 않는다.
구현 전이므로 sketch와 코드의 차이는 §13.2의 미완료 경계다. 구현 때 채택한 변경은 이 정본과 해당 REQ에 먼저 맞추고, 미수용 차이를 완료로 숨기지 않는다.
다음 첫 구현은 E1의 최신 시도/필수 gate/수집 중 완료 거절 테스트다. 이번 요청에서는 문서만 반영한다.

## 16. 출처와 재검증 경계

Super-agent 원문은 사용자가 제공한 전문을 기준으로 읽었다. [WeChat 원문](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg)은 직접 접근에 실패했다.
[공개 연구 프로토타입](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/6337fc823ce20251c8de8085948165c81aaa701e)은 고정 commit을 확인했다.
이 공개판은 DeepSeek Harness용 연구 구현이며 Ariadne·Codex·Claude Code 플러그인으로 설치하지 않는다.
공개 코드가 글의 전체 구상을 구현했다는 주장도 하지 않는다.

참고한 공개판 계약은 [권한](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/002-authorization.md)과
[실행](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/003-execution.md)이다.
글의 설계 원리와 공개판의 구체 상태·관측 모드를 구분하고, Ariadne의 더 좁은 권한 계약을 우선한다.
공급자 어댑터 구현 전에는 해당 날짜의 공식 문서·설치 버전·인증 조건·기능·실제 승인 동작을 다시 확인한다.
회사 소스·설정·인증 정보는 복사하지 않는다. 이 문서의 상태 모델과 계약은 Ariadne를 위한 새 설계다.


[Trackmind 원문](https://x.com/0xTrackmind/status/2113644871529418857)은 공개 기사 데이터와 [전재본](https://teapawt.net/0xTrackmind/article/2113644871529418857)의 본문·코드·도식 6개를 2026-11-02 대조했다.
작업 계약·작은 문맥 지도·실제 완료 검사·도구 계층 권한·제한된 반복·외부 상태·회귀 방지를 위 경계에 연결했다.
개인 20개 작업 결과와 도식 98%/12%, 40줄·3회는 Ariadne의 실측치나 고정 한도로 채택하지 않는다.
[LangChain 실험](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering)의 GPT-5.2-Codex 고정 결과는 하네스 조정의 사례이며 Opus 전용·Ariadne의 개선율이 아니다.
owner 설계는 [SQLite transaction](https://www.sqlite.org/lang_transaction.html)과 [rollback locking](https://www.sqlite.org/lockingv3.html)을 근거로 하며, epoch/dispatcher/복구 인수 검사는 별도 구현 대상이다.
[GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)은 병합 경계의 설정 조건을 확인하는 근거다. 새 보호 규칙을 설정하거나 외부 서비스를 활성화하지 않았다.
