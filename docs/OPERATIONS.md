# Ariadne 운영 가이드

## 업데이트 전파 (§5)

```bash
cd <ariadne-repo> && git pull
node --test && node scripts/verify.mjs   # green 확인 후
node scripts/install.mjs                 # ~/.harness 갱신 (멱등 — 변경분만 씀)
```

각 프로젝트는 session-start 훅이 버전 핀(`.harness/settings.json`)과 설치본 버전을
비교해 stale을 알리고 `/adapt --refresh`를 유도한다. 훅이 없는 프로젝트는
프로젝트에서 수동으로 `/adapt --refresh` 1회.

## 언인스톨 / eject (§5)

채택이 선택이려면 탈퇴 경로가 채택 경로만큼 명확해야 한다:

| 계층 | 명령 | 효과 |
|---|---|---|
| 글로벌 | `node scripts/uninstall.mjs` | manifest 기반 설치본 제거 + `--global-pointer` 주입분 원상 복원(백업) |
| 프로젝트 | `node scripts/adapt-remove.mjs --target <dir>` | 마커 블록·wrapper 제거, 백업 복원 — 왕복 후 `git status` clean이 정상 |

## 시크릿 정책 (§5)

- 리포·글로벌 계층 시크릿 **0**. 시크릿은 프로젝트 `.env`에만 (deny 규칙이 읽기 차단)
- 커밋 대상: wrapper, `decisions.md`. **`handoff/`는 로컬 전용** (gitignore 기본)
- handoff·볼트 승격 등 기록 경로는 scrub(13패턴)을 통과한 텍스트만 쓴다

## 버전 (§5)

리포 태그 = 하네스 버전. 같은 값이 3곳에 스탬프된다:
코어(`mirror-lib.mjs` VERSION) / wrapper 마커(`harness:begin v*`) / 프로젝트 핀(`.harness/settings.json`).
셋이 어긋나면 stale — session-start 훅이 알리는 것이 이 비교다.


## P0 실측 결과 (2026-07-19, macOS / Claude Code 2.1.215 / codex-cli 0.144.6)

### A1 — deny 규칙의 래퍼 우회: **확인됨 (설계 가정 유지)**

문서상 Claude Code가 벗기는 환경 러너는 `timeout`/`time`/`nice`/`nohup`/`stdbuf`와
플래그 없는 `xargs`뿐이다. 이 머신에 **`npx`와 `docker`가 모두 존재**하므로
`Bash(npx *)`·`Bash(docker exec *)` 형태의 allow 규칙은 임의 명령의 통로가 된다.

→ **결론: 문자열 기반 deny를 강제선으로 쓰지 않는다** (§0.2 3계층 OS sandbox가 필요한 이유).
실제 파괴 명령으로 검증하지 않았다 — 우회 가능성은 문서 근거 + 바이너리 존재로 판정했다.

### A3 — 훅·권한 관측: **확인됨, 그리고 현 환경의 갭 발견**

이 머신의 글로벌 `~/.claude/settings.json` 실측:
- `hooks`: **`Stop` 이벤트 하나만** 설정됨
- `permissions`: **`allow` 키만 존재 — `deny`·`ask`가 전혀 없음**

→ 현재 환경에는 시크릿 파일 접근·force push를 막는 규칙이 **하나도 없다.**
§4.11의 deny/ask 최소 세트가 실제로 필요하다는 근거이며, D3(기존 환경 불변)에 따라
이번에 수정하지 않고 하네스 템플릿으로 제공한다.

### A2/A4 — Codex approval_policy: **미확인 (판정 보류)**

`~/.codex/config.toml` 실측 결과 `sandbox_mode`와 `approval_policy`가 **여러 프로필에
중복 정의**되어 있고(`workspace-write`/`read-only`, `on-request`/`never` 혼재),
`network_access`는 미설정(기본값 = 차단)이다. 프로필 레이어링 때문에 실제 적용값이
호출 경로마다 달라 codex#11885(workspace-write가 approval_policy를 무시)를
이 환경에서 격리 검증할 수 없었다.

→ **판정: 미확인.** P4(게이트 구축) 시 클린 프로필로 재측정한다.
그때까지 Codex 측 승인 정책에 의존하는 설계 요소를 만들지 않는다.

---

## P1 발동 실측 결과 (2026-07-19~20, 스모크 — trig 3/non 3 쿼리)

### Codex 스킬 컨텍스트 2% 예산 캡 — **신규 gotcha (실측)**

`Exceeded skills context budget of 2%. All skill descriptions were removed and 59
additional skills were not included.` — 이 머신은 글로벌 `~/.codex/skills` 327개로
예산이 터져 **모든 스킬 description이 제거**된다. 병존 모드(D3)에서 Codex의
description 기반 발동은 구조적으로 불가. 단, 스킬이 프로젝트 작업 트리에 있으면
모델이 **파일 탐색으로 SKILL.md를 발견해 읽는 우회 경로**가 실측됨 — 메커니즘
발동과 구분해 집계할 것.

### Claude 발동률 변인 분리 (haiku 기본, 각 셀 n=3)

| 조건 | trigger 발동 | 오발동 |
|---|---|---|
| 병존(스킬 514개) + haiku | 0/3 | 0/3 |
| 격리(18개, `--setting-sources project`) + haiku | 1/3 | 0/3 |
| 병존 + sonnet | 2/3 | — |

→ **환경(카탈로그 크기)과 모델 등급 둘 다 실변수.** 공통 실패 모드는
"리포 탐색 먼저" 대체행위 — description의 차단 문구를 "구현하지 마라"가 아니라
**"탐색부터 시작하지 마라"**로 겨냥해야 함 (P1 REFACTOR로 반영).
n=3 스모크이므로 §4.13.7 전체 프로토콜(20쿼리×3회)은 P2 이후 과제.

### 미러 생성 규칙 (P1에서 실측된 버그)

generated 마커를 frontmatter **앞**에 넣으면 양 CLI 모두 로드 실패
(Claude: description 파싱 깨짐 / Codex: `missing YAML frontmatter` ERROR).
**생성물 1행은 반드시 `---`** — P2 생성기 테스트 케이스 1호.

---

## worktree 병렬 트러블슈팅

**worktree 격리를 신뢰하지 말 것** (§4.14.1 — 미해결 이슈들):

| 증상 | 원인 | 대응 |
|---|---|---|
| 미커밋 변경이 사라짐 | worktree 재활용이 살아있는 세션의 worktree를 삭제 (cc#77268). `git worktree lock`도 무시됨 | **세션 종료 전 반드시 커밋**. 되돌리기 비싼 작업 전 WIP 커밋 |
| 커밋이 엉뚱한 리포에 착지 | 실행 중 cwd가 메인으로 조용히 드리프트 (cc#76197) | 커밋 전 `git rev-parse --show-toplevel` 확인 |
| 격리 밖 파일이 수정됨 | 서브에이전트가 절대경로로 worktree 밖에 Write (cc#74726) | 절대경로 Write 금지를 REQ boundary_rules에 명시 |
| Codex 세션 간 컨텍스트 누수 | 인스턴스들이 `~/.codex/`를 공유 (codex#11435) | `CODEX_HOME=~/.codex-session-N`으로 분리 |

`.env` 등 gitignore 파일은 `.worktreeinclude`로 반입한다.

**reflog는 커밋된 것만 구한다** — `reset --hard`로 날아간 미커밋 변경은 복구 불가.

## 병렬 상한

동시 진행 REQ는 **사람 리뷰어 수 이하**. 소규모 팀 기준 2개.
근거: AI 생성 PR은 초기 리뷰 대기 4.6배, 고도입 팀 리뷰 시간 91%↑ (LinearB 810만 PR).
병목은 생성이 아니라 리뷰다.

## 도구 전환 규칙

Claude ↔ Codex 전환 시 **WIP 커밋으로 경계를 남긴다.** 두 도구가 같은 브랜치에서
미커밋 상태를 공유하지 않는다.
