> 현재 제품 설치·memory/code/knowledge 실행은 [통합 가이드](consolidation.md)를 따른다. 아래는 파일 기반 규칙 배포 절차다.

# Ariadne 온보딩

> 이 문서는 하네스를 처음 설치하는 팀원용이다. 설계 배경은 `DESIGN.md`를 본다.

## 1. 최소 버전 (P0 실측 기준선)

| 도구 | 최소 버전 | 확인 명령 | 이유 |
|---|---|---|---|
| Claude Code | **2.1.215** 이상 | `claude --version` | `Write(path)` deny 오용 startup 경고(2.1.210+), sandbox symlink 해석 |
| Codex CLI | **0.144.6** 이상 | `codex --version` | hooks·multi_agent·skills가 stable로 확정된 버전 |

Codex 기능 플래그 확인:
```bash
codex features list | grep -E "hooks|multi_agent|skill"
# hooks        stable  true   ← 훅 지원. false면 verify 게이트만이 앵커가 됨
# multi_agent  stable  true   ← .codex/agents/*.toml 서브에이전트
```

**구버전 팀원에게 무슨 일이 생기나**: Codex hooks가 없으면 REQ 커밋 불변식의 훅 계층이
빠지고 CI 백스톱만 남는다(§0.2 강제 계층). 동작은 하되 조기 경보가 사라진다.

## 2. Codex 필수 절차 — trusted project 승인

⚠ **`.codex/config.toml`을 커밋해도 각 개발자가 프로젝트를 신뢰하기 전에는 통째로 무시된다.**
프로젝트에서 Codex를 처음 실행할 때 신뢰 여부를 묻는데, 승인하지 않으면 프로젝트 계층
설정(sandbox, hooks 포함)이 로드되지 않는다.

확인 방법: `~/.codex/config.toml`의 `[projects]` 섹션에 해당 경로의 `trusted_hash`가 있으면 승인된 상태.

## 3. 설치

```bash
git clone <Ariadne-repo> Ariadne && cd Ariadne
node --test && node scripts/verify.mjs   # 받은 것이 green인지 먼저 확인
node scripts/install.mjs                 # ~/.harness에 core/skills/templates 및 context 실행 파일 설치 (멱등)
```

기본 설치는 **글로벌 설정(~/.claude, ~/.codex)을 건드리지 않는다** (D3).
글로벌 규칙 연결까지 원하면 opt-in 플래그를 명시한다:

```bash
node scripts/install.mjs --global-pointer
# ~/.claude/CLAUDE.md  ← 마커 블록 안에 @~/.harness/core/AGENTS.core.md 포인터 1줄
# ~/.codex/AGENTS.md   ← 마커 블록 안에 코어 규칙 사본 (Codex는 import 문법이 없다)
# 기존 파일은 ~/.harness/backup/에 백업 — uninstall이 원상 복원한다
```

제거는 대칭이다:

```bash
node scripts/uninstall.mjs   # manifest 기반 제거 + 글로벌 포인터 복원
```

프로젝트별 설치·제거는 해당 프로젝트에서 `/adapt` → `adapt-remove` (OPERATIONS 참고).

**소요 시간 실측 (2026-07-20, 클린 환경 — 격리 HOME + 프레시 클론)**:
클론 → 스모크 테스트 → 설치(+포인터) → adapt → 첫 REQ 커밋까지 **기계 시간 21초**.
문서 읽기와 대화형 단계(req-capture 질문 등)는 사람 속도에 달렸다 — 5분은 목표지 약속이 아니다.
주의: asdf/nvm 등 버전 매니저 shim 환경에서 서브프로세스를 띄우는 스크립트를 짤 때는
`process.execPath`를 쓴다 (PATH의 shim은 HOME·경로 조건에 따라 깨진다 — 실측된 gotcha).

## 4. 첫 작업

```
1. /adapt          — 프로젝트 감지 후 AGENTS.md·wrapper·게이트 생성
2. /req-capture    — 요구를 REQ YAML로. ready_for_routing 전에는 구현 금지
3. 구현 → verify → 커밋 (커밋 메시지에 `REQ: <slug>` 필수)
4. /handoff        — 세션 종료 시 진행 상태 기록
```

## 5. 옵션 모듈 (원하면)

| 모듈 | 추가 요구사항 |
|---|---|
| llm-wiki (볼트 승격 + 온톨로지 인덱스) | Obsidian 볼트 경로만 |
| Ariadne memory (영속 메모리) | Postgres + Docker, Node ≥22 |
| Ariadne code (임팩트 분석) | **Node ≥24** (내장 node:sqlite 사용) |
| telemetry (팀 집계) | OTel collector. `user.email`은 끌 수 없음에 유의 |

사용법·연결 방법은 [MODULES.md](./MODULES.md).
