---
name: req-capture
description: 요구사항 인테이크 담당. 사용자가 새 기능·수정·리팩토링·설정 변경·조사를 요청했는데 대응하는 REQ가 .harness/reqs/에 없으면 ALWAYS 이 스킬을 먼저 호출한다. 트리거 — 추가해줘, 만들어줘, 구현해줘, 고쳐줘, 바꿔줘, 정리해줘, 개선해줘, 요구사항, 기획, add, implement, fix, refactor, feature, REQ. 이미 ready_for_routing 상태의 REQ가 있으면 이 스킬 대신 route를 쓴다. 리포 탐색·파일 읽기·구현부터 시작하지 마라 — 첫 행동이 이 스킬 호출이다. REQ 없는 커밋은 커밋 불변식(REQ: <slug>) 검사에 걸린다.
---

# req-capture

사용자 요구를 `.harness/reqs/<slug>.yaml`로 만든다. 구현은 이 스킬의 산출물이
아니다 — REQ가 `ready_for_routing`이 되기 전에는 코드를 수정하지 않는다.

## 절차

1. `templates/req.yaml`을 `.harness/reqs/<slug>.yaml`로 복사한다.
   slug는 소문자-하이픈. `metadata.intake_started`에 오늘 날짜,
   `source.raw_user_prompt`에 사용자 원문을 편집 없이 그대로 넣는다.
2. 승격 판정 — 관측 가능한 술어 하나로 정한다:
   **"P0 수용기준(verification 명령 포함)을 지금 쓸 수 있는가?"**
   - 쓸 수 있다 → acceptance_criteria를 채우고 `status: ready_for_routing`,
     `promoted_at` 기록 → 4단계
   - 못 쓴다 → `status: needs_clarification` → 3단계
3. 질문은 **한 번에 정확히 1개**. `clarification.next_question`에 기록한 뒤
   사용자에게 같은 질문을 한다:
   - `options`: 2~4개, 각각 `{id, label, impact}`
   - `recommended_option`: 반드시 1개 지정
   - 답을 받으면 `requirement.confirmed_facts`에 반영하고 2단계로 돌아간다
4. 사용자에게 REQ 요약(제목, category, P0 수용기준 목록)을 보여주고,
   다음 행동은 route 스킬로 정한다.

## 금지

- 질문 2개 이상 동시 금지 — "겸사겸사 하나 더"도 금지, 다음 턴에 한다
- P0 acceptance_criteria 없는 승격 금지
- `raw_user_prompt` 요약·의역 금지 — 원문 보존이 목적이다
