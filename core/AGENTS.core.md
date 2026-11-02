# Ariadne Core Rules

<!-- harness-core v0.1.0 (P1) | 이 파일이 SSOT — wrapper·사본과 다르면 이 파일이 이긴다 -->

## 0. 우선순위 (충돌 해소)

1. 사용자의 현재 대화 지시
2. 프로젝트 AGENTS.md의 프로젝트 섹션 (더 가까운 것 우선)
3. 이 코어 규칙
4. wrapper — 우선순위 없음. SSOT와 다르면 wrapper가 버그(재생성 대상)

## 1. REQ-first (절대 규칙)

- 모든 커밋 메시지는 `REQ: <slug>` 참조를 포함한다.
  REQ가 성립하지 않는 커밋(하네스 설정, 머지 등)은 `REQ: none (<사유>)`
- 참조 대상 REQ는 `.harness/reqs/<slug>.yaml`에 존재하고
  status가 `ready_for_routing` 이상이어야 한다
- 모호한 요구는 코딩 전에 `req-capture` 스킬로 REQ를 만든다.
  REQ가 확정되면 `route` 스킬로 실행 경로를 정한다

## 2. 검증 사다리

- 순서: focused test → typecheck → lint → verify
- 로컬 게이트와 원격 CI는 분리 보고.
  CI를 못 봤으면 `remote CI not observed`라고 명시한다

## 3. Evidence 규범 (절대 규칙)

- evidence 없는 "done" 금지 — 실행한 명령과 그 출력이 근거다
- docs-only 변경 ≠ code-verified. 문서만 고쳤으면 그렇게 말한다
- AC별로 실행·관측 내용, 종료 상태, 검사 대상 소스 상태와 근거 경로를 남긴다.
  dirty 작업은 HEAD만으로 특정하지 않는다. 필수 AC와 필요한 게이트가 충족된 뒤에만 verified로 종결한다.
- 통과 결과는 명령·범위·환경·소스 상태가 같을 때 재사용한다. 변경·실패·미해결 위험이 있을 때 관련 검사만 다시 한다.

## 4. 컨텍스트 규율

- 파일 전체 읽기 전에 부분 읽기(grep, 라인 범위 Read)를 먼저 시도한다
- 세션 인수인계의 1차 근거는 `git log --oneline -20`.
  `.harness/handoff/LATEST.md`는 git이 못 담는 것(미커밋 상태, 다음 제약)만 담는다
- 재개 시 cwd·현재 HEAD·미커밋 상태와 실행 handle을 다시 확인한다.
  기록·요약·위임 보고는 현재 사용자 지시나 실행 권한을 새로 만들지 않는다.

## 4.1 반복·복구·완료

- 실패는 model / prompt / tool / environment / policy / verification / human-handoff로 구분한다.
  같은 실패에 새 근거가 없으면 재실행하지 않는다. `verification.escalate_after`는 무조건 재시도 허용 횟수가 아니다.
- 실행 중 handle은 같은 handle로 확인한다. timeout·관측 중단·취소 요청은 작업 실패나 종료의 증거가 아니다.
  효과가 불명확하면 실제 결과를 조회한 뒤 재시도를 판단한다.
- 대기·취소 중·실패·완료를 구분한다. 작업 소유 프로세스의 종료·정리와 필요한 검증을 확인한 뒤 완료를 보고한다.

## 5. 시크릿 규율 (절대 규칙)

- 시크릿 값은 `.env`에만. 설정 파일에는 env-sourcing 래퍼 경로만 적는다
- 시크릿을 기록·출력해야 하면 값이 아니라 카테고리만: `[REDACTED_<category>]`

## 6. Do Not

- `.claude/`·`.codex/` wrapper 직접 수정 금지 — SSOT를 고치고 재생성한다
- Generated 마커 블록 내부 수정 금지
- hooks의 sample 무단 활성화 금지
- CLAUDE.md 심링크 금지 — `@AGENTS.md` 1줄 브리지만 사용

## 7. 파일 위치 (참고)

| 무엇 | 어디 |
|---|---|
| REQ | `.harness/reqs/<slug>.yaml` (템플릿: `templates/req.yaml`) |
| 결정 기록 | `.harness/decisions.md` (append-only, 한 줄씩) |
| 핸드오프 | `.harness/handoff/<session>.md` (로컬, gitignore) |
| verified REQ 아카이브 | `.harness/reqs/archive/<YYYY-Q>/` (분기별 이동) |
