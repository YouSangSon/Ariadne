# Atlas에서 Ariadne에 적용한 원리

Atlas의 실행 엔진을 복제하지 않고, 현재 Ariadne에서 재현한 검증·컨텍스트 문제를 고쳤다.
반복·완료·복구 규율은 기존 REQ와 스킬에 반영했다. 자동 실행기와 P7 루프 모듈은 추가하지 않는다.

## 조사 기준과 한계

2026-11-02의 로컬 소스를 읽었다. 런타임은 `private-runtime-reference (비공개 참고 구현; 원본 이력 미게시)`,
앱은 `private-ui-reference (비공개 참고 구현; 원본 이력 미게시)`이다.
아래 원본 경로는 `private-reference/`의 각 저장소를 기준으로 한다.
회사 소스·API 계약·인증 설정은 복사하지 않았다.

런타임의 turnrun·toolrun·goal·context·checkpoint·delegation·평가 경계와 앱의 conversation controller·native bridge·검증 분리를 조사했다.
두 제품의 테스트는 assertion을 읽은 근거다. 이번 작업에서 제품 테스트·앱·서버·유료 모델은 실행하지 않았다.
전체 API·권한·sandbox·메모리 파이프라인·과거 readiness 기록의 완전 감사나 원격 최신성 검증은 범위 밖이다.

## 적용 판단

| 원리 | Atlas 원본 근거 | Ariadne의 적용과 검증 수준 |
|---|---|---|
| 프로세스 종료와 성공 분리 | 앱 `src/lib/runtime/conversation-controller.ts:164`, `src-tauri/src/runtime.rs:453` | **코드 수정.** `scripts/verify.mjs`는 spawn error·signal·nonzero status를 실패로 판정한다. 빈 stderr와 stdout-only 오류도 실패한다. `tests/verify.test.mjs`가 실제 하위 프로세스로 확인한다. |
| 원본 근거와 요약 분리 | 런타임 `internal/goal/goal.go:334`, `internal/model/model.go:43` | **코드·규율.** verify는 수집한 실패 출력을 scrub한 뒤 표시한다. 출력 수집 오류에서는 잘린 payload를 버리고 오류 원인만 보고한다. route·REQ 템플릿에 AC별 명령 또는 관측, 결과, 소스 상태, 근거 경로를 남긴다. AC 내용의 참·거짓을 자동 인증하는 새 엔진은 만들지 않았다. |
| 전체 입력 예산과 필수 원문 보존 | 런타임 `internal/context/tokens.go:16`, `internal/context/semantic.go:74` | **코드 수정.** 팩 전체에 brief 4,000·standard 10,000·deep 18,000 UTF-16 단위 상한을 둔다. REQ 목표·수용기준·제약·막힘이 먼저다. 필수 원문만으로 넘으면 출력 없이 실패한다. 토큰 계량이나 절감률은 아니다. |
| 의미 단위로 세션 상태 보존 | 런타임 `internal/context/incremental_summary.go:37`, 앱 `src/lib/runtime/workspace.ts:119` | **코드 수정.** handoff의 `다음 제약`과 `막힘`을 실제 헤딩으로 읽는다. 긴 파일 목록 뒤에서도 handle과 승인 대기를 보존한다. 헤딩 없는 과거 기록은 원문 전체를 필수 노트로 둔다. |
| 저장·출력 전 비밀 제거 | 런타임의 원본·projection 분리와 Ariadne의 기존 scrub 경계 | **코드 수정.** 모든 context 원문을 자르기 전에 scrub한다. 종전의 절단 후 scrub은 토큰 일부나 여러 줄 private key를 놓칠 수 있었다. 패턴 검출은 모든 종류의 비밀을 보장하는 보안 경계가 아니다. |
| 좁은 외부 입력 경계 | 앱 `src-tauri/src/runtime.rs:297` | **코드 수정.** REQ slug의 경로 이동·구분자를 거절하고 없는 명시 REQ·값 없는 CLI 인자를 오류로 처리한다. 활성 REQ가 여러 개면 `--req`를 요구한다. |
| 필수 제약의 형식 보존 | 런타임 `internal/context/semantic.go:201` | **코드 수정.** 선택한 REQ 필드의 원문 블록을 보존하여 flow-list·여러 줄 제약이 사라지지 않게 한다. 템플릿의 block mapping만 지원하며 중복·alias·anchor 등 지원하지 않는 형식은 명시적으로 거절한다. |
| 재시도도 비용과 한도를 소비 | 런타임 `internal/turnrun/run.go:128`, `internal/turnrun/run_test.go:242` | **실행 규율.** 실패 종류·gate·근거·바뀐 입력을 attempts에 남긴다. 재시도·재계획을 진전으로 취급하지 않는다. 자동 시도 예산·backoff 엔진은 P7 보류 경계를 유지한다. |
| 무진행과 반복 막힘 분리 | 런타임 `internal/store/goal.go:427` | **실행 규율.** 새 근거 없는 동일 실패를 반복하지 않고 `escalate_after`에서 현재 시도 경로를 중단한다. 모델이 만든 progress 문자열을 바꾸는 것을 진전으로 인정하지 않는다. Atlas의 두 카운터는 경계가 다르고 직접 회귀검사는 조사 범위에서 찾지 못했으므로 숫자를 복제하지 않았다. |
| 불명확한 효과는 재조회 | 런타임 `internal/toolrun/run.go:163`, `internal/store/lifecycle.go:302`; 앱 `src/lib/runtime/conversation-controller.ts:154` | **실행 규율.** timeout·관측 중단·취소 요청을 실패나 종료로 추정하지 않는다. 같은 handle·요청 ID와 실제 효과부터 확인하고 인수인계에 남긴다. DB·effect journal은 추가하지 않는다. |
| 오래된 관측의 권위 제한 | 앱 `src/lib/runtime/conversation-controller.ts:57`, `:92` | **실행 규율.** context 재개 시 cwd·HEAD·dirty 상태·handle을 다시 확인한다. 과거 통과 결과는 동일 명령·범위·환경·소스에서만 재사용한다. 비동기 상태 관리기가 없는 Ariadne에 generation 엔진은 만들지 않는다. |
| 완료 전에 child·실행·정리 확인 | 런타임 `internal/turnrun/run.go:183`, `internal/agent/engine_cleanup_test.go:99` | **실행 규율.** 작업 소유 프로세스·resource 정리와 필수 검증이 끝나야 verified로 종결한다. 다른 작업의 cache·process·변경을 정리하지 않는다. |
| 위임 보고와 통합 증거 분리 | 런타임 `internal/store/delegation_goal_evidence.go:70` | **기존 원칙 유지.** 부모가 소유 파일·기준 revision·실제 diff·통합 후 검증을 확인한다. lease·grant·workspace 관리자는 이식하지 않는다. |
| checkpoint 적용 전 재확인 | 런타임 `internal/checkpoint/plan.go:48`, `internal/checkpoint/apply.go:86` | **실행 규율.** handoff에 기준 상태를 남기되 재개 시 현재 상태를 확인한다. Git·diff로 충분한 프로젝트에 별도 CAS·복원 엔진은 만들지 않는다. |
| 기록과 실행 권한 분리 | 런타임 `internal/model/model.go:36`, `internal/context/history_budget_test.go:207` | **기존 공지·규율 보강.** 팩·위임·외부 검색 결과가 현재 사용자 권한을 새로 만들지 않는다. 승인 대기를 실패나 완료로 바꾸지 않는다. |
| 평가 장치의 유효성과 작업 성공 분리 | 런타임 `internal/orchestrationeval/judge.go:18`, `cmd/agent-eval/public_verification_test.go:105` | **검증 적용.** 실제 오류 때문에 red인지 확인한 뒤 수정한다. 중첩 Node test 환경이 자식 검사를 건너뛰는 fixture 문제를 먼저 바로잡았다. P8의 고정 태스크·rubric·유료 평가를 대신한 것으로 보고하지 않는다. |
| 생성 원본과 provenance 유지 | 앱 `scripts/sync-runtime-contract.mjs:17` | **이미 충족.** 기존 SSOT·원본 hash·mirror 생성·check-mirror를 사용한다. 별도 registry는 추가하지 않는다. |

## 가져오지 않은 제품 기능

앱의 SSE transport에 자동 reconnect·durable cursor·dedup이 완성돼 있다고 가정하지 않았다.
`src/lib/runtime/client.ts:108`은 그 책임을 소비 화면에 남긴다. auth epoch 타입도 enforcement의 증거가 아니다.
앱의 pending request Map은 프로세스 재시작 뒤의 내구성을 보장하지 않으며, 모든 4xx를 미접수로 일반화하지 않는다.

provider 원문 replay·서명, 인증·승인 UI, HTTP·SSE bridge, sandbox, 모델 비용 원장,
checkpoint 복원기와 다중 에이전트 스케줄러는 제품 런타임의 책임이다. Ariadne에는 해당 원리 중 필요한 규율만 반영했다.
Model Portfolio와 기존 P8 작업은 보존하며, 이번 로컬 검사가 모델 호환성·품질 동등성·토큰 효율을 증명하지 않는다.

## 확인 방법

실제 임시 설치 경로의 CLI도 확인했다. 경로 별칭과 모듈의 실제 경로를 문자열로 비교하던 진입 조건 때문에
exit 0인데 출력이 비는 문제를 재현했다. 같은 파일인지 실제 경로로 비교하도록 고치고 별칭 실행 회귀검사를 추가했다.

`node --test tests/verify.test.mjs tests/context-pack.test.mjs`는 새 실패 경계를 확인한다.
`node scripts/check-mirror.mjs`는 양 CLI용 스킬 미러를 대조하고, `node scripts/verify.mjs`가 저장소 전체 게이트다.
실행 결과와 원본 로그는 작업 REQ의 `verification.evidence`를 확인한다. 스킬 문장의 실제 에이전트 준수율은 별도 평가가 필요하다.

출력 수집 오류의 payload 생략은 [Node의 `spawnSync`와 `maxBuffer` 계약](https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options)에 따른다.
한도를 넘은 출력은 잘릴 수 있으므로 그 일부를 완전한 로그나 안전하게 가린 원문으로 취급하지 않는다.

예를 들어 외부 작업 요청이 timeout났지만 기존 요청 ID로 완료가 조회되면, 같은 작업을 새 요청으로 다시 보내지 않는다.
검증 프로세스가 아무 설명 없이 exit 7로 끝나면, 빈 오류 문자열과 무관하게 게이트는 실패다.
새로운 문제에도 "관측이 끊겼는가, 실제 실행이 실패했는가"를 먼저 구분한다.
