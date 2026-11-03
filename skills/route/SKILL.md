---
name: route
description: REQ 라우팅 담당. .harness/reqs/에 ready_for_routing 상태의 REQ가 있고 구현·실행 경로를 정해야 하면 ALWAYS 이 스킬을 호출한다. 트리거 — 라우팅, 다음 단계, 이제 뭐해, 진행해, 구현 시작, route, proceed, start implementation. REQ가 없거나 needs_clarification 상태면 이 스킬 대신 req-capture를 쓴다. 라우팅 표를 거치지 않고 임의로 실행 경로를 정하지 마라.
---

# route

`ready_for_routing` REQ의 `classification.category`를 아래 표에 대조해
실행 경로를 정한다. 표 밖의 경로를 임의로 만들지 않는다.

## 라우팅 표 (코어 기본값 — 프로젝트 AGENTS.md가 행을 추가할 수 있다)

| category | 경로 |
|---|---|
| feature | 실패하는 테스트 먼저 → 구현 → `verification.commands` 실행 |
| fix | 재현 테스트 작성 → 원인 수정 → `verification.commands` 실행 |
| refactor | `verification.commands` 선실행(green 확인) → 변경 → 재실행 |
| config | 변경 → `verification.commands` 실행 |
| docs | 변경 → 링크·경로 유효성 확인 |
| investigation | 조사 → 결과를 `requirement.confirmed_facts`에 기록. 코드 수정 금지 |

## 규칙

- category는 LLM 분류다 — 결정론이라 주장하지 않는다.
  `confidence: low`면 라우팅 전에 사용자에게 category 확인 질문 1개
- 경로 시작 전에 `audit.must_not_implement`를 읽고 그 목록은 건드리지 않는다
- AC의 ID·본문을 구현 결과에 맞춰 바꾸지 않는다. 범위가 바뀌면 REQ 변경 이유를 먼저 기록한다.
- 실패 시 `verification.attempts`에 gate·실패 종류·막힘·근거·바뀐 입력을 남긴다.
  실패 종류는 model / prompt / tool / environment / policy / verification / human-handoff 중 실제 원인으로 정한다.
  새 근거·수정 없이 같은 실패를 재실행하지 않는다. 연속 실패가 `escalate_after`에 도달하면 현재 시도 경로를 중단하고 원인·필요한 다음 행동을 보고한다.
- timeout이나 세션 전환 뒤에는 기존 handle·요청 ID와 실제 효과부터 확인한다.
  승인 대기·실행 중·취소 중·결과 불명은 실패나 완료가 아니다. 불명확한 효과를 자동 재실행하지 않는다.
- 완료 시 `verification.evidence`에 AC별 실행 명령 또는 관측 내용, 결과·exit code,
  검사 대상 소스 상태와 보존한 근거 경로를 남긴다. dirty 소스는 HEAD와 함께 diff·파일 hash 등의 근거로 특정한다.
  실행하지 않은 검사는 `not_run`, 불명확한 결과는 `unknown`으로 남긴다.
- 필수 AC가 실제로 충족되고 필요한 게이트와 작업 소유 resource 정리가 끝나야
  acceptance_criteria의 `passes: true`와 `status: verified`를 기록한다.
  커밋 메시지에 `REQ: <slug>`를 포함한다. fixture·로컬 검사를 CI·배포·실환경 완료로 확대하지 않는다.
