# Ariadne 모듈 가이드

코어 동작에 필수인 모듈은 없다. 각 모듈은 요구사항을 먼저 확인하고 선택 설치한다.

## llm-wiki — 볼트 승격 + 온톨로지 인덱스 (이 리포에 구현 존재)

요구사항: Obsidian 볼트 경로만. 사용법은 [modules/llm-wiki/README.md](../modules/llm-wiki/README.md).

## akasha — 팀 공유 영속 메모리 (외부 리포 연결, §4.9)

- **요구사항 (설치 전 확인)**: Postgres(+Docker), Node ≥22
- 제공: 팀 공유 영속 메모리, 시맨틱 검색, goal-run(반복 감지 포함)
- 연결 방법: akasha 리포의 init 절차로 MCP 서버 설정 주입 + env-sourcing 래퍼 구성,
  기존 파일 메모리(`.harness/` 기록)는 seed 임포트로 이관
- 하네스 쪽 변경 없음 — MCP 설정 연결만 (§7: akasha 코드 수정 금지)

## parallax — 코드 임팩트 분석 (외부 리포 연결, §4.9)

- **요구사항 (설치 전 확인)**: **Node ≥24** (내장 node:sqlite 사용)
- 제공: 코드 임팩트 분석, repo map, 텔레메트리
- 연결 방법: MCP 설정 주입 + 프로젝트에서 `.parallax/` 초기 인덱싱 1회
- 하네스 쪽 변경 없음 — MCP 설정 연결만 (§7: parallax 코드 수정 금지)

## telemetry — 팀 집계 (§4.9)

- **요구사항 (설치 전 확인)**: OTel collector 엔드포인트
- 주의: `user.email` 필드는 끌 수 없다 — 팀 공지 후 활성화할 것
