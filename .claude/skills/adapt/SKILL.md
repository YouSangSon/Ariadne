---
name: adapt
description: 프로젝트 하네스 맞춤 담당. 사용자가 하네스 설치·적용·프로젝트 셋업·adapt·refresh를 요청하면 ALWAYS 이 스킬을 호출한다. 트리거 — 하네스 적용, 하네스 설치, 프로젝트 셋업, 맞춤, adapt, refresh, onboard project. 일반 기능 요구는 이 스킬이 아니라 req-capture를 쓴다. 감지 없이 검증 명령을 추측 생성하지 마라 — 기존 스크립트를 찾고, 없으면 사용자에게 확인한다.
---

<!-- generated: mirror of skills/adapt/SKILL.md | sha256:aaf31831e003 — 직접 수정 금지 -->

# adapt

프로젝트를 감지해 하네스 파일을 생성·갱신한다. 판단(감지·확인·보고)은 여기서,
파일 쓰기는 스크립트가 한다 — 스크립트 소스를 읽지 말고 블랙박스로 호출한다.

## 절차

1. **감지** — 실제 파일로 확인한다 (추측 금지):
   `package.json`의 scripts(test/lint/typecheck), `Makefile`, `pyproject.toml`,
   `go.mod`, CI 설정, 모노레포 워크스페이스
2. **검증 명령 확정** — 감지된 기존 스크립트를 채택한다.
   없으면 **사용자에게 질문 1개**로 확인한다 (추측 생성 금지)
3. **생성** — `node scripts/adapt-apply.mjs --target <프로젝트> --verify-cmd "<확정 명령>"`
   실행. 캡 산정·마커·백업·manifest는 스크립트 소관이다.
   재실행(refresh)도 같은 명령 — 멱등이다
4. **충돌 보고** — 프로젝트의 기존 규칙 파일(CLAUDE.md 사용자 영역, 글로벌 지침)과
   코어 규칙이 충돌하는 항목을 **보고만** 한다. 수정하지 않는다 (§2.2)
5. **보고** — 스크립트가 출력한 created/updated/skipped와 다음 단계
   (첫 REQ는 req-capture로)를 사용자에게 전한다

제거는 `node scripts/adapt-remove.mjs --target <프로젝트>` — manifest 기반 복원,
사용자 파일과 `.harness/reqs/`는 보존된다.

## 금지

- 마커(`<!-- harness:begin/end -->`) 밖 내용 수정 금지 — 사용자 소유다
- 검증 명령 추측 금지 — 감지 실패 시 질문이 정답이다
- 글로벌 설정(~/.claude, ~/.codex) 수정 금지 (D3)
