# Ariadne — 통합 코딩 에이전트 하네스 설계서

> Parallax · akasha · atlas-code 세 프로젝트의 검증된 메커니즘을 합쳐,
> Claude Code와 Codex를 동등하게 지원하는 팀 배포용 하네스를 만든다.
> 목표는 두 가지다: **효율(컨텍스트 낭비 제거)** 과 **정확(성급한 구현·검증 누락 차단)**.

작성일: 2026-07-19 · 상태: **APPROVED (v7)** — 구현 착수(P0). 결정 22건, 리서치 5라운드 반영
소스 분석: 3개 프로젝트 소스 정독 + 웹/GitHub/Codex 실측 리서치 완료
리뷰: 독립 Claude 리뷰(critical 3·high 10 반영) + 외부 근거 User Challenge 2회 통과

---

## 0. 확정된 결정 (Decision Log)

| #   | 결정              | 선택                                                                                              | 근거                                                                               |
| --- | ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D1  | 산출물 형태       | **글로벌 설정 재구성 + 프로젝트별 자동 맞춤(2계층)**                                              | 글로벌 코어는 한 번 설치, 프로젝트 진입 시 adapt가 맞춤 생성                       |
| D2  | 대상 에이전트     | **Claude Code + Codex 동등 지원**                                                                 | AGENTS.md를 SSOT로, CLAUDE.md는 import 포인터                                      |
| D3  | 기존 환경         | **건드리지 않음** — 독립 산출물, 채택은 사용자 선택                                               | 현행 ECC/superpowers/gstack와 병존, 완성 후 전환 판단                              |
| D4  | 사용 범위         | **처음부터 팀 배포용**                                                                            | 설치 스크립트·온보딩·시크릿 정책 포함                                              |
| D5  | 메모리 레이어     | **파일 기반 코어 + akasha/Parallax MCP는 옵트인 모듈**                                            | 팀원 온보딩에 Docker/Postgres 강제 안 함                                           |
| D6  | 프로세스 엄격도   | **모든 작업 REQ-first** — 집행 불변식: "모든 커밋은 REQ 참조를 가져야 한다" (§4.3.1, D8에서 확정) | atlas-code 원판 + 집행 가능 재정식화                                               |
| D7  | 프로젝트 맞춤     | **adapt 스킬(에이전트 주도)**                                                                     | 스택 감지 로직을 코드가 아닌 스킬 지침으로 유지                                    |
| D8  | REQ 집행          | **커밋 불변식** — 모든 커밋에 `REQ: <slug>` 참조, 훅+verify 집행                                  | 리뷰 지적("게이트 없는 규칙은 부탁") 수용                                          |
| D10 | REQ 범위 재확인   | **전면 적용 유지** — 업계의 차등 게이트 권고를 인지한 상태에서 사용자가 원 방향 재확인            | 팀 작업 특성 판단. 사문화 시그널은 REQ 타임스탬프로 감시                           |
| D12 | 자원 규율         | **cheapest-signal-first를 제1설계원칙으로** (§2.0 비용 사다리)                                    | 최소 자원으로 최대 효율·정확 — 싼 결정론 신호가 먼저 거르면 비싼 판단이 정확해진다 |
| D13 | Goal/Loop 축      | **표준 사이클·완료 판정·보상 해킹 방어는 코어, 자율 루프는 옵션 모듈** (§4.10)                    | 웹+GitHub 루프 리서치 종합 — 종료 3계층 없는 루프는 배제                           |
| D15 | 강제 계층         | **CI가 진짜 강제선, 훅은 조기경보로 강등** (§0.2)                                                 | 훅 조용한 미발화·무한루프·에이전트 우회가 전부 실증됨                              |
| D16 | 채택 도구         | **beads·probity 배제, ralph-loop 플러그인 미채택, ralphex 보류** (§0.2)                           | 데이터 무결성·fail-open·LLM 판정자 환각 등 결함 확인                               |
| D17 | 효과 측정         | **P8 하네스 평가 신설** (§6)                                                                      | METR 19% 지연 실측 등 회의론 — 체감 아닌 측정으로 판단                             |
| D18 | 권한              | **OS sandbox를 강제 계층에 삽입, deny/훅은 조기경보로** (§4.11)                                   | 공식 문서가 deny·훅 정규식을 "fragile"이라 명시, npx/docker exec 우회              |
| D19 | 관측              | **로컬 JSONL + 훅 자기감사 우선, OTel은 옵션 모듈** (§4.12)                                       | D12 정합 — 비용 0 수단이 이미 존재                                                 |
| D20 | 스킬 저작         | **발동·실행을 별도 실패로 취급, 베이스라인 대조 없는 스킬은 만들지 않음** (§4.13)                 | 지시형 description 오즈비 20.6 실측, 커뮤니티 스킬 73%가 60점 미만                 |
| D21 | 병렬 운영         | **오케스트레이션 미구축, 병렬 상한은 리뷰어 수 이하** (§4.14)                                     | worktree 격리가 양 도구에서 버그 상태, 병목은 생성이 아니라 리뷰(LinearB 91%↑)     |
| D22 | 복구·에스컬레이션 | **미커밋 자동 기록 + 7분류 원인 태그 + 3-strike 중단** (§4.14)                                    | 전부 기존 컴포넌트 확장, 신규 시스템 0                                             |

### 0.1 리뷰 반영 이력

v2에서 독립 리뷰의 critical 3건·high 10건을 반영했다. 핵심 교정:

- **뿌리 문제 인정**: 이 설계는 atlas-code의 규칙을 가져오면서 그 규칙을 살아있게 만들던
  런타임을 제외했다. 그 공백을 §4.3.1(REQ 집행 앵커), §4.6(밀폐 verify), §4.7(훅)이 메운다.
- Codex 소비 표면은 **미검증 가정**이었음 → v3에서 공식 문서 + 로컬 실측(0.144.6)으로 검증 완료 (§2.3)
- verify의 글로벌 상태 의존 제거 → 버전 핀 + 스탬프로 밀폐화 (§4.6)
- 파일판 컨텍스트 팩의 토큰 절약 근거 재정립 → 서브에이전트 조립 (§4.4)

v3 리서치 반영 (웹 베스트 프랙티스 + GitHub 실전 리포 + Codex 실측):

- **Codex 훅 시스템 확인** (10 이벤트, PreToolUse 차단 가능, 0.144.6 stable) —
  "Codex엔 verify가 유일한 앵커" 전제 폐기, 훅을 양 에이전트 공통 1차 앵커로 (§4.7)
- **`.codex/agents/*.toml`·skills는 바닐라 규약 확정** — P0 스파이크를 "팀 머신 버전 확인"으로 축소 (§6)
- **wrapper 생성기 대폭 축소** — CLAUDE.md=`@AGENTS.md` 1줄 브리지(업계 지배 패턴:
  yarl·ignite-3·egg 등), 스킬은 `.agents/skills/`(Codex 네이티브 스캔) 중심 배포 (§2.3)
- **규칙 볼륨 상한 명문화** — 업계 컨센서스(root 50~200줄, 포인터 스타일,
  "규칙을 더하면 준수율이 떨어진다") 반영 (§4.1)
- **Claude Code 내장 auto memory와 정합** — 자체 메모리 포맷을 내장 MEMORY.md
  인덱스+토픽 구조에 맞춤 (§4.4)
- 참고한 선례: ECC `sync-ecc-to-codex.sh`(마커 머지+백업+dry-run), spec-kit
  `check-prerequisites.sh`(파일 존재 게이트), ruler/rulesync(3+ 툴 시 채택 후보)

---

## 0.2 반증 조사 결과 — 강제 계층 재설계 (v5)

적대적 반증 조사에서 설계의 3대 가정이 실증적으로 흔들렸다. 방어하지 않고 구조를 고친다.

### 반증 1 — "훅 = 결정론"은 거짓 (가장 위험)

증거: PreToolUse Edit/Write 매처가 세션 내내 **조용히 미발화**(claude-code#74942),
Stop 훅 무한 루프로 세션 소진(#55754, #69201), 에이전트가 `--no-verify`·`git stash`로
훅을 **6연속 우회**하고 이슈는 not-planned로 종결(#40117), 훅 오버헤드 툴콜당 ~80ms.

**설계 변경**: 훅은 결정론 계층에서 **편의·조기경보 계층으로 강등**한다.

```
강제 계층 재정의 (아래로 갈수록 신뢰도 높음)
1. 규칙 파일(AGENTS.md)  — advisory. 준수는 아키텍처적으로 비강제(#53223)
2. deny/ask 규칙 + 훅     — 조기 경보. 공식 문서가 스스로 "fragile"이라 명시.
                           문자열 매칭이라 npx/docker exec/devbox run으로 우회됨
3. OS sandbox            — ★ Seatbelt/bubblewrap 경계. 모델이 무엇을 실행하든 유지 (v6 신설)
4. verify (로컬)          — 결정론이나 실행 여부가 사람/에이전트 의지에 달림
5. CI / 브랜치 보호       — ★ 진짜 강제선. 우회 불가한 최종 계층
```

**v6 추가 — 3계층(OS sandbox)이 빠져 있었다.** 문자열 기반 차단(2계층)의 한계가 공식 문서에
명시돼 있다: 환경 러너 중 `timeout/nice/nohup/xargs`만 벗기고 **`npx`·`docker exec`·
`devbox run`·`mise exec`는 안 벗긴다** → `Bash(devbox run *)` allow가 `devbox run rm -rf .`를
통과시킨다. `Read`/`Edit` deny도 `cat`/`sed`는 인식하지만 **파일을 직접 여는 python/node
스크립트는 못 막는다**. OS 경계만이 이를 막는다.

주의: 내장 Bash sandbox는 **Bash와 그 자식만** 격리한다 — MCP 서버와 훅은 호스트에서
무제한 실행된다. 그리고 sandbox 기본 read 정책은 **전체 디스크 읽기 허용**이라
`~/.ssh`·`~/.aws/credentials`가 기본으로 안 막힌다 (**built-in credential deny list는 없음**).

- **모든 불변식은 4계층(CI)에 최종 백스톱을 둔다.** 훅에만 의존하는 규칙은 없다
- 훅은 **fail-open/fail-closed를 항목별로 명시**하고, Stop 훅에는 `stop_hook_active`
  체크 + 자체 반복 카운터를 의무화
- **훅 발화 감사**: 훅이 실제로 불렸는지 로그로 남겨 "조용한 미발화"를 감지
  (미발화 자체가 관측되지 않으면 규칙이 죽은 줄도 모른다)
- 매처는 최소 범위로 (오버헤드 + 오탐 축소)

### 반증 2 — 브리지가 조용히 깨진다

증거: Claude Code는 CLAUDE.md가 **심링크면 쓰기 거부**(#66559), `@import`는 상위 디렉토리·
서브디렉토리 실행·서브에이전트 정의에서 **조용히 무시**(#78216, #78697, #5914),
Codex는 32KiB 초과분을 **경고 없이 절단**(codex#7138, #13386), 동일 지시문을 두 에이전트가
다르게 해석한 실측 사례 존재.

**설계 변경**:
- **심링크 금지** — `@AGENTS.md` import만, 그것도 **같은 디렉토리 레벨**에서만
- **AGENTS.md 합산 20KiB 상한** (32KiB 캡 대비 여유분 확보). verify가 검사
- **브리지 해석 검증을 verify에 추가**: 두 에이전트에서 "지금 로드된 지침이 무엇인지"를
  실제로 물어 확인하는 스모크 (조용한 no-op 감지)
- 포인터 스타일은 **참고 자료 전용**. 절대 규칙 소수는 인라인 (포인터를 따라 읽으라는
  지시 자체가 무시될 수 있음)

### 반증 3 — 파일 메모리는 stale로 썩는다

증거: beads 저자가 이 도구를 만든 이유가 "에이전트가 수백 개 쓸모없는 md를 만들고
상충·구식 문서 사이에서 치매에 걸린다", HN 실사용자 "stale 티켓에 걸려 토큰을 태운다",
Claude 내장 auto-memory는 200줄/25KB에서 **조용히 절단**(#57574, #39811).

**설계 변경**:
- **만료·prune 정책을 초기부터**: 모든 handoff/decisions 엔트리에 날짜 스탬프,
  handoff는 N일 경과 시 자동 아카이브, decisions는 superseded 즉시 이동
- **"결정"과 "브레인스토밍"을 파일 레벨에서 분리** — 미확정 사고는 decisions에 안 들어감
- **내장 auto-memory와 병행 금지** — 한쪽만 쓴다 (이중 기록·불일치 방지).
  기본값: 자체 파일 메모리 사용, 내장 auto-memory 비활성
- 팩 조립 시 stale 엔트리(만료 경과)는 제외

### 채택 도구 재평가 (전부 알려진 결함 확인됨)

| 도구            | 발견된 결함                                                                                                       | 판정                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 공식 ralph-loop | "재시작 없는 루프는 Ralph의 핵심을 부순 것"이라는 정면 비판, 활성 루프 없어도 종료 차단(#574), 실행권한 누락 반복 | **패턴만 참고, 플러그인 미채택**. 루프는 프로세스 재시작 방식으로 |
| ralphex         | 업스트림 CLI 변경에 취약(#398), 플랜 rename 시 무한 스핀(#341), 동시 실행 충돌(#331)                              | **보류** — 필요 시점에 재평가                                     |
| beads           | 동시 부하에서 close 후 상태 미영속(#4767), 며칠 stale 읽기(#4746), 침습적 git 조작 비판                           | **배제** — 데이터 무결성 이슈가 목적을 무효화                     |
| probity         | fail-open 3건(#40,#30,#34), **LLM 판정자가 자기 과거 거부에 앵커링해 환각**(#24)                                  | **배제** — "LLM으로 LLM 감시"는 결정론이 아님                     |

### 효과 회의론 — 정직하게 기록

METR RCT: 숙련 개발자가 AI 도구로 **19% 느려졌으나 본인은 20% 빨라졌다고 체감**.
GitClear: 코드 복제 8배, 2주 내 재수정 3.3%→7.1%. SDD 후기: "마크다운 리뷰가 구현보다
오래 걸린다". **"프로세스 파일을 늘리면 나아진다"는 직접 실증은 어디에도 없다.**

→ 그래서 §6에 **하네스 자체 평가(P8)** 를 넣는다. 체감이 아니라 측정으로 판단한다.
측정 없이 하네스를 키우는 것은 이 조사가 경고하는 바로 그 실패다.

---

## 1. 용어 (Ubiquitous Language)

설계·구현·문서 전체에서 아래 용어만 사용한다.

| 용어               | 정의                                                                                                               | 출처              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------- |
| **SSOT**           | 워크플로 지침의 단일 원본. `skills/<name>/SKILL.md`. wrapper는 전부 여기서 생성된다                                | atlas-code        |
| **Wrapper**        | SSOT를 가리키는 툴별 얇은 포인터. 자동 생성물이며 **손으로 쓰지 않는다**                                           | atlas-code        |
| **REQ**            | 요구사항 YAML. `needs_intake → needs_clarification → ready_for_routing` 상태기계. `ready_for_routing` 전 구현 금지 | atlas-code        |
| **Gate**           | 결정론적 검증 명령. 단일 `verify` 진입점 + 수치화된 캡                                                             | atlas-code        |
| **Context Pack**   | 작업 시작 시 주입하는 예산 제한 컨텍스트. 5섹션 고정 스키마                                                        | akasha + Parallax |
| **Budget Preset**  | brief/standard/deep 3단 컨텍스트 예산 표                                                                           | Parallax          |
| **Handoff Ledger** | 세션 간 연속성 원장. 세션 ID·타임스탬프별 병기(덮어쓰기 금지)                                                      | Parallax          |
| **Decision Log**   | append-only 결정 기록. 삭제 없음, supersede + 주기 아카이브                                                        | Parallax + akasha |
| **Scrub**          | 저장·전송 경계의 시크릿 검출. 값은 노출하지 않고 카테고리만 보고                                                   | akasha + Parallax |
| **Adapt**          | 프로젝트 진입 시 스택·컨벤션·검증명령을 감지해 프로젝트 계층을 생성하는 스킬                                       | 신규              |
| **Advisory**       | 차단하지 않는 코칭 신호                                                                                            | atlas-code        |
| **Evidence**       | 완료 주장의 근거. evidence 없는 "done" 금지                                                                        | atlas-code        |
| **Generated 블록** | 마커로 감싼 자동 생성 영역. adapt가 무조건 덮어쓴다. 마커 밖은 사용자 소유로 불가침                                | 신규 (리뷰 3-1)   |
| **Manifest**       | adapt/install이 생성한 파일 목록 (`.harness/manifest.json`). 언인스톨·감사의 근거                                  | 신규 (리뷰 4-2)   |

---

## 2. 아키텍처

### 2.0 자원 규율 (Resource Discipline) — 제1설계원칙 (D12)

**모든 컴포넌트는 "가장 싼 신호를 먼저, 가장 비싼 판단을 마지막에" 순서로 동작한다.**
효율과 정확은 트레이드오프가 아니다 — 싼 결정론 신호가 먼저 걸러줄수록
비싼 LLM 판단은 애매한 케이스에만 집중되어 정확도도 올라간다.

**비용 사다리** (위가 쌀수록 먼저):

```
0. 캐시 히트          — content-hash 재사용 (Parallax 팩 캐시 패턴). 계산 자체를 생략
1. 결정론 검사        — 린트·타입체크·테스트·해시 비교·파일 존재. 훅/verify가 담당
2. 부분 읽기          — 컨텍스트 팩·grep·라인 범위 Read. 전체 파일 읽기 금지가 기본
3. 단일 LLM 판단      — 본 세션의 추론. 1-2가 걸러낸 애매한 것만
4. 서브에이전트       — 조립·검증 위임. 본 세션 컨텍스트 보호가 목적일 때만
5. 다중 보이스/루프    — 적대 리뷰, 반복 실행. 되돌리기 비싼 결정(설계·릴리스)에만
```

적용 규칙:

- **훅·게이트는 1에서 끝낸다** — LLM에게 "지켰는지 판단"을 맡기지 않는다
  (커밋 형식, REQ 참조, 줄수 캡 전부 정규식/파일 검사).
  probity의 LLM 판정자가 자기 과거 거부에 앵커링해 환각한 사례가 이 원칙의 반례 증명
- **캐시 안정성 규율 (실측 반영)**: 컨텍스트 캐시는 `tools(MCP) → system → 규칙파일 →
  messages` 좌→우 체인이라 왼쪽 변경이 오른쪽 전부를 무효화한다. 따라서
  **세션 중 규칙 파일 편집·MCP 추가·모델 전환 금지** (설정은 세션 시작 전 확정).
  가변 정보(handoff/decisions)는 반드시 체인 오른쪽(파일 읽기)에 둔다 — 현 설계와 일치.
  건강도 지표: `cache_read / cache_creation` 비율 2:1 이상
- **모델 라우팅은 세션 단위로**: 서브에이전트는 저비용 모델(haiku급) 기본,
  **오케스트레이터는 다운그레이드 금지**(조정 품질 저하 보고). 태스크 중간 모델 스위칭은
  캐시 전체 무효화라 절감분을 반납한다. 라우팅 판정에 LLM을 쓰지 않는다(결정론 규칙만)
- **같은 입력 재계산 금지** — 팩·검사 결과는 content hash로 캐싱, 멱등 ID로 중복 기록 no-op
  (Parallax `INSERT OR IGNORE` + atlas-code 결정적 recordId 패턴)
- **조기 종료 우선** — 루프·검사는 실패를 빨리 드러내는 순서로 배열 (fail-fast),
  성공 확인은 필요한 최소 증거로
- **측정 없이는 최적화 없음** — 각 스킬은 소비 신호(읽은 파일 수, 팩 재사용 여부)를
  handoff에 남겨 비싼 경로가 관측되게 한다 (Parallax 텔레메트리 원칙의 파일판)
- **정확이 우선하는 예외**: 보안 경계(scrub), 데이터 보존(append-only), evidence 규범은
  자원 절약 대상이 아니다 — 여기서 아끼면 재작업 비용이 절약분을 초과한다

```
┌─────────────────────────────────────────────────────────────┐
│  harness repo (이 리포, SSOT)                                │
│  core/ skills/ hooks/ lib/ templates/ scripts/ modules/     │
└──────────────┬──────────────────────────────────────────────┘
               │ harness install  (멱등, akasha init 패턴)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  글로벌 계층                                                  │
│  ~/.harness/            ← 스킬·훅·lib 설치본 + user 메모리    │
│  ~/.claude/ 포인터       ← 주입은 사용자 확인 후 (D3)          │
│  ~/.codex/ 코어 규칙     ← Codex용 코어 규칙 사본 (§2.3)       │
└──────────────┬──────────────────────────────────────────────┘
               │ /adapt  (프로젝트에서 실행, 재실행 안전)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  프로젝트 계층  <project>/                                    │
│  ├─ AGENTS.md            ← Generated 블록(코어 요지+프로젝트   │
│  │                          섹션) + 사용자 자유 영역           │
│  ├─ CLAUDE.md            ← "@AGENTS.md" (기존재 시 상단 삽입)  │
│  ├─ .claude/ .codex/     ← wrapper (자동 생성, 버전 스탬프)    │
│  ├─ .harness/            ← handoff/, decisions.md, reqs/,   │
│  │                          settings.json(버전 핀), manifest │
│  └─ verify 연결           ← 감지·보정된 게이트                 │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 지침 우선순위 (충돌 해소 규칙)

1. 사용자의 현재 대화 지시
2. 프로젝트 `AGENTS.md` 프로젝트 섹션 (더 가까운 것 우선 — atlas-code 규칙)
3. 코어 규칙 (AGENTS.md 내 Generated 코어 블록)
4. wrapper — 우선순위 없음. SSOT와 다르면 SSOT가 이기고 그 자체가 재생성 대상 버그

**병존 모드 주의** (리뷰 1-4): D3에 따라 기존 글로벌 설정(ECC 등)과 병존하는 동안
"컨텍스트 낭비 제거" 목표는 달성되지 않는다 — 오히려 규칙이 이중 로드된다.
효율 목표의 달성 시점은 **전환 후**로 명시한다. adapt는 실행 시 기존 글로벌 지침과
충돌하는 항목(예: 타 프로세스 규칙)을 감지해 보고만 하고 수정하지 않는다.

### 2.3 Claude Code / Codex 매핑 (v3 — 공식 문서 + 로컬 실측 0.144.6으로 검증 완료)

| 개념          | Claude Code                                   | 바닐라 Codex                                                                                             | 판정 근거                              |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 글로벌 규칙   | `~/.claude/CLAUDE.md`                         | `~/.codex/AGENTS.md` (+override 우선)                                                                    | 공식 문서 + 로컬 실측                  |
| 프로젝트 규칙 | `CLAUDE.md → @AGENTS.md` 1줄 브리지           | AGENTS.md를 git루트→cwd로 **연결(concat)**, 합산 32KiB 캡                                                | 공식 문서                              |
| import 문법   | `@file` (최대 4단 중첩, 단 런치 시 전부 로드) | **없음** — 연결이 전부                                                                                   | 공식 문서 (확정 부재)                  |
| 스킬          | `.claude/skills/`, `~/.claude/skills/`        | `.agents/skills/`(네이티브 스캔), `~/.agents/skills/`, `~/.codex/skills/`. `$skill` 발동 + 암묵 발동     | 공식 문서 + 실측                       |
| 서브에이전트  | `.claude/agents/*.md`                         | `.codex/agents/*.toml` — **바닐라 지원 확정** (2026-03 도입)                                             | 공식 문서 + 실측                       |
| 훅            | `.claude/settings.json` hooks                 | **있음** — `.codex/hooks.json`/config.toml, 10 이벤트, PreToolUse 차단·입력 재작성 가능 (0.144.6 stable) | 공식 문서 + `codex features list` 실측 |
| 슬래시 커맨드 | `.claude/commands/*.md`                       | `~/.codex/prompts/` — **deprecated, 스킬 권장**                                                          | 공식 문서                              |
| 프로젝트 설정 | `.claude/settings.json`                       | `.codex/config.toml` (trusted 프로젝트 한정)                                                             | 공식 문서                              |
| MCP           | `.mcp.json`                                   | config.toml `[mcp_servers.*]`                                                                            | 실측                                   |

**배포 단위 원칙 (v3 간소화)** — 무거운 wrapper 생성기를 버린다:

1. **지침**: AGENTS.md가 원본, CLAUDE.md는 커밋된 `@AGENTS.md` 1줄 브리지
   (업계 지배 패턴 — GitHub 코드 검색에서 유명 OSS 다수 확인. 심링크는 Windows/CI 문제로 비채택)
2. **스킬 = 배포 단위**: SSOT SKILL.md를 `.agents/skills/`에 두면 Codex는 네이티브로 읽는다.
   Claude Code용으로는 `.claude/skills/<name>` → `.agents/skills/<name>` 참조 스텁만 생성.
   SKILL.md 포맷은 양쪽 사실상 호환 (Codex 실측 보고)
3. **서브에이전트 wrapper만 생성 대상**: `.claude/agents/*.md` ↔ `.codex/agents/*.toml`
   — 불투명 템플릿 치환(`{name, description, pointer}`), 생성물에 버전+SSOT 해시 스탬프
4. **32KiB 예산 관리**: Codex는 글로벌+프로젝트 AGENTS.md를 전부 연결하므로
   코어 규칙+프로젝트 섹션 합산이 예산의 절반을 넘지 않도록 verify가 검사
5. 3개 이상 툴(Cursor 등) 지원이 필요해지면 자작하지 않고 **ruler/rulesync 채택 검토**
   (동일 문제를 푸는 기성 도구 — GitHub 조사에서 확인)

---

## 3. 리포 구조 (harness repo)

```
harness/
├── AGENTS.md / CLAUDE.md      # dogfood
├── DESIGN.md                  # 이 문서
├── core/AGENTS.core.md        # 배포되는 공통 규칙 원본 (버전 스탬프 포함)
├── skills/<name>/SKILL.md     # SSOT 스킬 (§4.2)
├── hooks/
│   ├── handoff-check.mjs      # 이중 포맷 훅 (atlas-code 이식)
│   ├── commit-message.mjs     # PreToolUse 커밋 검증 (atlas-code 이식)
│   ├── session-start.mjs      # 버전 핀 대조 → stale이면 advisory (리뷰 2-3)
│   ├── req-anchor.mjs         # REQ 집행 앵커 (§4.3.1, opt-in)
│   └── samples/               # opt-in settings 샘플 (자동 활성화 금지)
├── lib/                       # 순수 모듈 (의존성 0)
│   ├── scrub.mjs              # 시크릿 검출 — 합집합 ~16패턴
│   ├── context-pack.mjs       # 5섹션 팩 빌더
│   ├── budget.mjs             # brief/standard/deep 프리셋
│   └── generate-wrappers.mjs  # 템플릿 치환 + 스탬프 + 일관성 검사
├── templates/
│   ├── req.yaml               # REQ 스키마 (category enum 포함)
│   ├── handoff.md / decisions.md
│   ├── wrapper.claude.md      # 불투명 템플릿 (§2.3)
│   ├── wrapper.codex.tmpl     # P0 결과에 따라 확정
│   └── AGENTS.project.md      # Generated 블록 골격
├── scripts/
│   ├── install.mjs            # 글로벌 설치 (멱등: created/updated/skipped)
│   ├── uninstall.mjs          # manifest 기반 제거 (글로벌/프로젝트) (리뷰 4-2)
│   ├── verify.mjs             # 이 리포의 게이트
│   └── check-mirror.mjs       # wrapper 스탬프 vs 핀 대조 (CI 실행 가능)
├── modules/
│   ├── akasha/README.md       # Postgres 필요 명시, seed 임포트 절차
│   └── parallax/README.md     # Node ≥24 필요 명시
└── docs/
    ├── ONBOARDING.md
    └── OPERATIONS.md          # 업데이트 전파, 훅 정책, 트러블슈팅, eject
```

---

## 4. 컴포넌트 설계

### 4.1 AGENTS.core.md — 공통 규칙

**볼륨 상한 (v3)**: 코어 규칙은 **150줄 이하, 포인터 스타일** — 산문 설명 대신
명령·파일 위치로 라우팅한다. 근거: Anthropic 공식 "200줄 미만, 비대한 파일은 실제
지시를 무시하게 만든다" + 업계 "규칙을 더하면 준수율이 떨어진다"(150줄 실질 상한 보고).
**매번 강제돼야 하는 규칙은 산문이 아니라 훅으로 강등한다** (공식 구분: CLAUDE.md는
advisory, hook은 deterministic). verify가 줄수 캡을 검사한다.

1. **우선순위 규칙** — §2.2 (atlas-code)
2. **REQ-first 의무** (D6) — 집행 형식은 §4.3.1
3. **검증 사다리** — focused test → typecheck → lint → verify.
   로컬 게이트와 원격 CI 관찰 분리 보고, 미관찰 시 `remote CI not observed` 명시 (atlas-code)
4. **Evidence 규범** — evidence 없는 done 금지, docs-only ≠ code-verified (atlas-code invariant)
5. **컨텍스트 규율** — 파일 전체 읽기 전에 컨텍스트 팩/부분 읽기 우선
6. **시크릿 규율** — 시크릿은 `.env`만, 설정 파일에는 env-sourcing 래퍼 경로만 (akasha)
7. **Do Not** — wrapper 직접 수정 금지, 훅 sample 무단 활성화 금지, generated 마커 침범 금지

### 4.2 스킬 카탈로그 (SSOT)

| 스킬          | 역할                                                                                                                              | 출처              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `req-capture` | 요구 → REQ YAML, 상태기계, blocker 질문 1개 규칙                                                                                  | atlas-code        |
| `route`       | REQ category → 스킬 **테이블 기반** 라우팅 (리뷰 3-4: category는 LLM 분류이므로 "결정론" 주장 안 함). 프로젝트 계층이 테이블 확장 | atlas-code        |
| `adapt`       | 프로젝트 감지 → Generated 블록·wrapper·게이트 생성                                                                                | 신규              |
| `context`     | **서브에이전트에 위임해** handoff/decisions/REQ에서 팩 조립, 본 세션엔 팩만 반환 (리뷰 3-2)                                       | akasha            |
| `verify-plan` | 변경 → 테스트 다이어그램 → 게이트 실행                                                                                            | atlas-code        |
| `handoff`     | 세션 종료: Handoff Ledger 기록 + 결정 append + 미완료 명시 + **REQ 타임스탬프 기록** (리뷰 4-4)                                   | Parallax + akasha |
| `retro`       | **종료 근거 기록만** — 반복 감지는 코어에서 제외, akasha 모듈 설치 시에만 시맨틱 판정 (리뷰 5-4)                                  | akasha 축소판     |

### 4.3 REQ 스키마 (templates/req.yaml)

atlas-code 스키마 이식 + 보강:

- `metadata.status`: `needs_intake | needs_clarification | ready_for_routing` (+종결 `verified`)
- `metadata.intake_started / promoted_at` — 마찰 데이터 수집용 타임스탬프 (리뷰 4-4)
- `source.raw_user_prompt` 원문 보존
- `classification.category` — **enum을 스키마에 명시** (기본: feature | fix | refactor |
  config | docs | investigation; 프로젝트 계층이 확장) (리뷰 3-4)
- `clarification.next_question`: 질문 1개 + `options[{id,label,impact}]` + `recommended_option`
- `requirement`: confirmed_facts / assumptions / rejected_assumptions 분리
- `functional_contract.acceptance_criteria[{priority, statement, verification}]`
  — **P0 AC 없으면 승격 불가**
- `verification.commands` — adapt가 감지한 명령이 기본값
- `audit.must_not_implement[]`

보존: `<project>/.harness/reqs/`. **아카이브 규약을 처음부터 정의** (리뷰 5-3):
`verified` REQ는 분기별 `reqs/archive/<YYYY-Q>/`로 이동, decisions.md의 superseded
항목은 `decisions.archive.md`로 이동. 나중에 정하면 마이그레이션이 된다.

#### 4.3.1 REQ-first 집행 앵커 (D8 확정: 커밋 불변식)

**불변식: 모든 커밋은 REQ 참조(`REQ: <slug>`)를 가져야 한다.**

- 집행 3중선 (v5 — 훅 신뢰성 반증 반영):
  1. commit-message 훅 — 같은 턴 자기수정 유도 (조기경보, 우회 가능함을 전제)
  2. verify의 커밋 로그 검사 — 로컬 결정론
  3. **CI/브랜치 보호 — 진짜 강제선.** 훅은 `--no-verify`로 우회되므로(claude-code#40117
     실증) 여기가 없으면 불변식이 아니다
- **`--no-verify` 차단**을 PreToolUse에 추가하되, 이것도 우회 가능하므로 CI가 최종 판정
- **탈출구 명시**: REQ가 성립하지 않는 커밋(하네스 설정, 머지 커밋 등)은
  `REQ: none (<사유>)` 형식을 허용 — 탈출구가 없으면 에이전트가 우회를 학습한다
- 참조 대상 REQ는 `ready_for_routing` 이상 상태여야 유효
- 프롬프트 규범("모호하면 코딩 전 REQ")은 그대로 유지 — 불변식은 최후 방어선이지
  대체재가 아니다. 리뷰 지적(1-1·5-2)대로 "게이트 없는 규칙은 부탁"이므로,
  D6의 "모든 작업"을 검사 가능한 "모든 커밋"으로 재정식화했다

### 4.4 파일 기반 메모리 (D5 코어)

```
~/.harness/memory/user.md                  # user scope
<project>/.harness/handoff/<session>.md    # 세션별 파일 — 덮어쓰기 대신 병기 (리뷰 4-1)
<project>/.harness/handoff/LATEST.md       # 최신 세션 심볼릭 요약 (handoff 스킬이 갱신)
<project>/.harness/decisions.md            # append-only + 주기 아카이브
```

**내장 기능과의 정합 (v3)**: Claude Code에는 auto memory(MEMORY.md 인덱스 첫 200줄/25KB
세션 로드 + 토픽 파일 온디맨드)가 이미 내장돼 있다. 자체 메모리는 이를 대체하지 않고
**같은 포맷 규약을 따른다**: decisions.md는 인덱스(최근 N개 상단 고정)+아카이브 구조로,
Claude 쪽에서는 auto memory가 자연 수용하고 Codex 쪽에서는 context 스킬이 읽는다.
세션 인수인계의 1차 근거는 **git log**(업계: "git log --oneline -20이 가장 신뢰할 수 있는
기록"), handoff 파일은 git이 못 담는 것(미커밋 상태, 다음 슬라이스 제약)만 담는다.

- **랭킹**: project가 user를 절대 우선 (akasha 1000:0 규칙)
- **팩 조립은 서브에이전트가 수행** (리뷰 3-2): 본 세션이 원본 파일을 직접 읽으면
  절약하려던 토큰을 조립 과정에서 소모한다. akasha에서 조립이 서버(대화 밖)에서
  일어나던 구조를 서브에이전트로 재현한다. 캐시 친화 정렬은 파일판에서 근거가
  약하므로 규칙에서 제외 — akasha 모듈(진짜 세션 시작 주입) 사용 시에만 적용
- **팩 스키마**: 5섹션 개수 상한(akasha) + **문자수 상한 추가**(Parallax snippetChars 방식)
- **동시 세션 규약** (리뷰 4-1): handoff는 세션별 파일이라 충돌 없음. decisions.md
  append 경합은 "한 줄 append만 허용" 규약으로 완화(병합 충돌 시 양쪽 보존이 자연 해소).
  REQ 상태 전이는 파일당 단일 작성자 규약(REQ는 세션 간 공유하지 않음)
- **scrub 실패 시 동작** (리뷰 3-3): 전면 거부가 아니라 **매칭 구간만 `[REDACTED_<카테고리>]`
  치환 후 저장 + advisory 보고**. 전면 거부는 재생성 가능한 데이터(REQ 원문)에만

### 4.5 시크릿 방어 (lib/scrub.mjs)

Parallax 13 + akasha 12 패턴 합집합(중복 제거 ~16종): OpenAI/Anthropic(순서: ant 먼저),
Stripe, GitHub, Slack, AWS(키+시크릿 페어), GCP, npm, JWT(Bearer보다 먼저), Bearer 헤더,
DB URL(userinfo 필수), PEM 블록.

원칙: ① 매칭 값은 절대 반환하지 않고 카테고리만 (akasha) ② truncate 시
`[REDACTED_` 토큰 경계 보존 (Parallax) ③ 콜사이트 3계층 — 저장·전송·로그 경계.

### 4.6 게이트 (verify) — 밀폐(hermetic) 설계 (리뷰 2-1)

**원칙: 프로젝트의 verify는 글로벌 설치본 없이 성립한다.**

1. **단일 진입점**: 감지된 typecheck → lint → test → 커스텀 체크. 실패 시 즉사
2. **수치 캡**: atlas-code 수치(314줄 등)는 **신규 파일 기본값**일 뿐이다.
   브라운필드에서는 adapt가 **기존 코드 분위수를 측정해 "현행 최대치+여유"를 캡**으로
   설정하고, 신규 파일에만 엄격 캡 적용 (리뷰 3-5 — 첫 verify부터 대량 red로
   게이트 신뢰가 무너지는 것 방지)
3. **check-mirror 2단 분리** (리뷰 2-1·2-4):
   - **self-check (verify 포함, CI 가능)**: wrapper 스탬프의 SSOT 해시 ↔ `.harness/settings.json`
     버전 핀 대조. 글로벌 설치본 불필요
   - **freshness (별도 진단)**: 설치본 vs 핀 불일치는 verify 실패가 아니라
     "harness upgrade needed" 경고. 같은 커밋이 사람마다 다른 verify 결과를 내지 않게 함
4. **커밋 메시지 훅**: conventional commit 10타입 + 70자 + (§4.3.1 채택 시) REQ 참조 검사
5. **CI 구분 표**: OPERATIONS.md에 "CI에서 도는 검사(self-check, 캡, 테스트) /
   로컬 전용(freshness, 훅)" 명시 (리뷰 4-3)

### 4.7 훅 (hooks/) — v3: 양 에이전트 공통 1차 앵커

**전제 교체**: Codex에도 훅이 있다(10 이벤트, PreToolUse 차단·입력 재작성,
`.codex/hooks.json`/config.toml, 0.144.6 stable 실측). 따라서 결정론 앵커는
"훅 우선, verify 폴백"의 2단이다 — 훅 미지원 구버전 Codex에서만 verify가 단독 앵커.
REQ 커밋 불변식(§4.3.1)도 양쪽 모두 PreToolUse 훅으로 집행 가능.

- **이중 포맷 원칙**: 검사 로직 1개, 출력 어댑터 N개 (atlas-code 패턴) —
  Claude settings.json 포맷과 Codex hooks.json 포맷을 같은 스크립트가 서빙
- **session-start 훅** (리뷰 2-3): 세션 진입 시 버전 핀 대조 → stale이면
  "`/adapt --refresh` 실행하라" advisory. stale 상태로 작업하는 창을 세션 진입 시점에 닫음
- **handoff-check**: stop 시 미완료 + blocked 사유 없으면 advisory. whitespace만 deny
- **opt-in 강제**: 모든 훅 settings는 `samples/`에만 (atlas-code 3중 명시 정책)

### 4.8 adapt 스킬 (D7)

```
1. 감지 — 스택/테스트 러너/린터/CI/모노레포를 실제 파일로 확인
2. 검증 명령 확정 — 기존 스크립트 채택, 없으면 제안 후 사용자 확인 (추측 생성 금지)
   + 수치 캡 산정: 기존 코드 분위수 측정 → 브라운필드 캡 결정 (§4.6-2)
3. 생성 — 파일을 두 부류로 구분 (리뷰 3-1):
   - Generated 블록 (마커 <!-- harness:begin/end -->, 재실행 시 무조건 갱신):
     AGENTS.md 코어 요지+프로젝트 섹션, wrapper, .harness/ 템플릿
   - 사용자 소유 (절대 불가침): 마커 밖 전부
   기존 CLAUDE.md가 있으면: 백업 후 최상단에 "@AGENTS.md" 삽입 (병합 규칙 명시)
   모든 생성 파일을 .harness/manifest.json에 기록 (리뷰 4-2)
4. 게이트 연결 — verify 등가물 없으면 최소 게이트 제안
5. 충돌 보고 — 기존 글로벌 지침과 충돌 항목 감지·보고 (수정은 안 함, §2.2)
6. 보고 — created/updated/skipped + 다음 단계
```

`adapt --refresh`: Generated 블록만 재생성. `uninstall`: manifest 기반 제거 + 백업 복원.

### 4.9 옵션 모듈 (modules/)

| 모듈     | 제공                                                       | 요구사항                    | 설치 시                                                    |
| -------- | ---------------------------------------------------------- | --------------------------- | ---------------------------------------------------------- |
| akasha   | 팀 공유 영속 메모리, 시맨틱 검색, goal-run(반복 감지 포함) | Postgres(+Docker), Node ≥22 | MCP 설정 주입 + env-sourcing 래퍼, 파일 메모리 seed 임포트 |
| parallax | 코드 임팩트 분석, repo map, 텔레메트리                     | **Node ≥24**                | MCP 주입 + `.parallax/` 초기 인덱싱                        |

두 모듈 모두 코어 동작에 필수가 아니며, 설치 문서에 요구사항을 첫 줄에 명시.

### 4.10 Goal/Loop 운영 (v4 — 웹+GitHub 루프 리서치 반영)

#### 4.10.1 표준 작업 사이클 (코어 — 모든 작업의 기본 루프)

```
REQ 1개 선택 → 구현 → verify → 커밋(REQ: <slug>) → handoff/progress 갱신 → 세션 리셋
```

- **반복당 REQ 1개** (snarktank/ralph 21k★의 "반복당 1 스토리" + Anthropic "한 번에 기능 1개"
  — 컨텍스트 고갈 전에 커밋 가능한 단위로 끊는다)
- **긴 작업은 compaction이 아니라 리셋**: Anthropic 실측에서 "구조화된 핸드오프 + 세션 리셋"이
  compaction을 이김. 진행 상태는 컨텍스트가 아니라 파일과 git에 축적 (Ralph 원리)
- **git 커밋 = 체크포인트/롤백 지점**. 세션 시작 시 `git log --oneline -20` + handoff부터 읽기

#### 4.10.2 완료 판정 — 에이전트 발화 배제

- REQ의 acceptance criteria는 **`passes: false`로 초기화**되고, **verify 게이트만이
  `passes: true`로 승격**할 수 있다. "구현 완료" 발화는 판정에 쓰지 않는다
  (Anthropic effective-harnesses의 failing-초기화 feature list 패턴)
- **자기 채점 금지 (AGENTS.core.md 명문화)**: 구현한 세션이 검증하면 "검증이 아니라
  합리화"(hallucinated compliance). 검증은 **fresh-context 서브에이전트**가 diff + REQ
  기준만 보고 수행. Claude가 구현했으면 Codex가 리뷰하는 교차 검증 권장 (ralphex 구조)

#### 4.10.3 보상 해킹 방어 (훅)

- PreToolUse 훅: 테스트 파일 삭제·`skip`/`only` 마킹·assertion 약화를 감지 → 승인 요구
- verify: **테스트 수 감소 자체를 실패 조건**으로 (보상 해킹 벤치마크의 표준 방어책)

#### 4.10.4 자율 루프 (옵션 모듈 `modules/loop/` — 코어 아님)

공식 ralph-loop 플러그인의 검증된 메커니즘을 채택하되, 종료 판정을 강화:

- **구동**: Stop 훅 `{"decision":"block","reason":"<프롬프트 재주입>"}` + 상태 파일
  frontmatter(iteration/max/session_id — 세션 격리, corruption 시 fail-open 루프 해제)
- **종료 3계층 (전부 필수 — 성숙 구현들의 공통 구조, 단일 계층은 장난감)**:
  1. 완료: verify 통과 ∧ REQ 전부 close (promise 문자열 단독 판정 금지 — 자기 신고는 보조)
  2. 예산: `max_iterations ∨ max_cost(usd 누적) ∨ max_duration` OR 결합
     (vercel ralph-loop-agent의 술어 조합 설계 + continuous-claude의 cost 실측 로직)
  3. stall: **diff fingerprint N회 무변화**("말로는 진행, 실제 diff 없음" — ralphex
     ReviewPatience 이식) ∨ 연속 verify 실패 N회 (서킷브레이커)
- **운영 정책**: 무기한 자율 루프 금지 (Ralph 창시자 본인이 그린필드 전용 명시,
  overbaking·머지 충돌 실증 사례). 야간 cron 1회·작은 단위·아침에 사람이 머지까지만
- 공식 플러그인조차 `--max-iterations` 무시 버그 전례(#18646) → **하네스 자체 카운터
  파일을 내장 상한과 별도로 이중화**

#### 4.10.5 학습 승격 파이프라인

- 반복 중 얻은 교훈은 **Sign 포맷**으로 decisions.md에 기록:
  `Trigger(언제) / Instruction(뭘 하라) / Added-after(몇 번째 반복, 왜)` (iannuttall/ralph 실물)
- 반복 검증된 Sign은 **AGENTS.md 프로젝트 섹션으로 승격** (snarktank learnings→AGENTS.md
  규칙) — 단 §4.1 볼륨 상한 안에서. 파일 메모리→SSOT로 흐르는 유일한 공식 경로

#### 4.10.6 채택 vs 자작 판정

| 항목                                 | 판정                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 표준 사이클·완료 판정·보상 해킹 방어 | **자작** (코어 — REQ 스키마·훅·verify에 필드/검사 추가 수준)                                                      |
| 자율 루프 구동부                     | 공식 ralph-loop 패턴 **차용** + 종료 3계층 자작                                                                   |
| Claude 구현→Codex 리뷰 파이프라인    | 필요 시 **ralphex 채택** (1.4k★ Go 단일 바이너리, 유일한 성숙물)                                                  |
| goal/의존성 추적 고도화              | 필요 시 **beads 검토** (25k★, `bd ready` 큐, Claude/Codex 겸용 1급) — Dolt 의존이 무거워 REQ 파일로 부족해질 때만 |
| TDD 훅 집행                          | 필요 시 **tdd-guard→probity 검토** (Codex 겸용 후속작)                                                            |
| claude-flow(Ruflo)                   | **배제** — 표면적 거대, "작고 검증 가능한 불변식" 철학과 정반대                                                   |

### 4.11 권한 (Permissions) — v6 신설

#### 4.11.1 Claude Code 정책 (`templates/settings.claude.json` → adapt가 Generated 블록 생성)

평가 순서는 **deny → ask → allow, 첫 매치 결정, 구체성은 순서를 못 바꾼다.**
따라서 **deny에는 예외를 넣을 수 없다** → *deny는 "절대 금지"만, 회색지대는 전부 ask*.

deny 최소 세트: `Read(**/.env)`, `Read(**/.env.*)`, `Edit(**/.env*)`, `Read(~/.ssh/**)`,
`Read(~/.aws/**)`, `Bash(git push --force *)`, `Bash(git push -f *)`, `Bash(rm -rf /*)`
ask: `Bash(git push *)`, `Bash(gh pr merge *)`, `Bash(*migrate*)`, `Bash(*drop *)`
추가: `disableBypassPermissionsMode: "disable"` (bypass 금지 — 이게 있으면 sandbox-runtime 불필요)

**문법 함정 (verify가 검사)**:
- `Write(path)`·`Glob(path)` 형태는 **매칭 안 됨** — 파일 권한은 `Edit(path)`/`Read(path)`만 본다
- user settings의 `Read(/secrets/**)`는 `~/.claude/secrets/**`를 뜻함 — 전역은 `//` 또는 `~/` 앵커
- `Bash(ls*)`는 `lsof`까지 매칭 (공백 필수), `Bash(command:rm *)`은 무시됨

#### 4.11.2 Codex 대칭 정책 (`templates/config.codex.toml`)

```toml
sandbox_mode = "workspace-write"
approval_policy = "on-request"
[sandbox_workspace_write]
network_access = false
```
⚠ **trusted projects 승인 전에는 `.codex/` 계층이 통째로 무시된다** — 온보딩 문서 필수 항목.
⚠ workspace-write가 `approval_policy`를 무시한다는 미해결 이슈(codex#11885) → P0 실측 항목.

#### 4.11.3 시크릿 방어 3계층 (§4.5 확장)

`lib/scrub.mjs`(문자열 패턴)만으로는 서브프로세스의 직접 파일 읽기를 못 막는다:
1. scrub — 저장·전송 경계의 문자열 검출
2. `sandbox.credentials.files/envVars`에 `mode:"deny"` — OS 계층 (기본 목록이 없으므로 직접 열거)
3. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` — 자식 프로세스 env에서 자격증명 제거

#### 4.11.4 프롬프트 인젝션 (팀 배포의 실질 위협)

2026년 실사례: 공개 이슈 하나로 `ANTHROPIC_API_KEY`/`GITHUB_TOKEN` 유출(Comment and Control),
공개 리포 이슈로 비공개 리포 데이터 유출(GitLost), 악성 코드 없는 리포가 에이전트 조종(RoguePilot).
공통점 — **공격에 필요한 권한이 "write"에서 "이슈 쓸 수 있는 무료 계정"으로 내려갔다.**

방어는 **네트워크 egress**가 본선: sandbox `allowedDomains`에 최소 도메인만.
단 기본 프록시는 TLS를 종료하지 않아 **`github.com` 같은 넓은 허용 자체가 유출 경로**(§8 리스크 등재).
WebFetch 도메인 제한만으로는 부족 — Bash의 `curl`/`wget`이 열려 있으면 무의미.

#### 4.11.5 격리 판정 (소규모 팀)

내장 Bash sandbox 채택(Docker 불필요, macOS 셋업 0). **devcontainer·VM·sandbox-runtime은 미채택** —
`disableBypassPermissionsMode: "disable"`로 bypass를 막으면 필요성이 사라진다.
**git worktree는 격리 수단이 아니다** — sandbox가 linked worktree에서 메인 `.git` 쓰기를 허용한다.

### 4.12 관측 (Observability) — v6 신설

D12(cheapest-signal-first)에 따라 **로컬 JSONL 우선, OTel은 옵션 모듈**.

#### 4.12.1 이미 존재하는 것 (비용 0)

- Claude Code: `~/.claude/projects/<경로>/<session-uuid>.jsonl` (append-only, 1줄 1이벤트)
- Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-<id>.jsonl`
- ⚠ 툴이 `.env`를 읽으면 **그 값이 그대로 JSONL에 남는다** → transcript는 복사·공유 금지, 경로만 기록

#### 4.12.2 훅 발화 감사 (`hooks/audit-log.mjs` + `.harness/audit.jsonl`)

v5 D15("훅 조용한 미발화")에 대응하는 관측 수단. 훅 stdin에 `session_id`·`prompt_id`·
`transcript_path`·`permission_mode`가 전부 오므로 훅이 자기 발화를 스스로 append한다:

```jsonc
{"ts":"...","event":"PreToolUse","hook":"danger-guard","tool":"Bash",
 "fired":true,"blocked":false,"session_id":"...","req_id":"...","git_sha":"..."}
```

**발화(fired)와 차단(blocked)을 별도 필드로** — exit 2만 차단이고, PostToolUse 등
절반의 이벤트는 exit 2가 무효라 "돌았는데 아무 일도 안 일어남"이 정상 동작이기 때문.

무료 온디맨드 수단: `/hooks`(등록 현황+출처), `claude --debug`(발화·matcher 매치 사유까지).

#### 4.12.3 verify 편입

verify가 `.harness/audit.jsonl` 최신 세션에 기대 훅 이벤트가 있는지 대조 →
없으면 **"hook silent" 경고**(실패 아님, freshness와 동급). 규칙이 죽은 줄 모르는 상태를 방지.

#### 4.12.4 사후분석 최소 아티팩트 8종 (handoff 스킬이 기록)

transcript 경로 / `session_id`+`prompt_id` / tool_decision 시퀀스 / tool_result(실패 지점) /
훅 3-state(등록·발화·차단) / git SHA+브랜치+REQ id / verify 결과 / 하네스 버전 스탬프.
이 8개면 "누가·언제·어떤 REQ로·무엇을 승인받아 실행해서·어느 게이트에서 깨졌는지"가 재구성된다.

#### 4.12.5 팀 집계 (`modules/telemetry/` — 옵션)

Claude Code·Codex 모두 `tool_decision`/`tool_result` 이벤트 이름이 **대칭**이라 공통 스키마 가능.
`OTEL_LOG_*`는 전부 off 기본 → 프롬프트·응답·툴 인자·파일경로 유출 없이 집계된다.
⚠ 단 `user.email`·`user.id`·`organization.id`는 **끌 수 없다**(문서 첫 줄에 명시할 것).

#### 4.12.6 불필요 판정 (소규모 팀 — 과설계 배제)

MDM 배포 / `allowManaged*` 잠금류 / TLS 종료 프록시 / OTLP collector+Grafana 상시 운영 /
devcontainer 전면 도입 / VM / sandbox-runtime / **훅 정규식으로 완벽 차단 시도**(공식이
fragile이라 명시 — 패턴 정교화에 시간 쓰지 말 것, 진짜 차단은 sandbox+CI).

### 4.13 스킬 저작 규약 (v7 신설) — 하네스 본체의 품질 규칙

스킬 7개가 이 하네스의 본체다. **"어떻게 써야 실제로 발동하고 끝까지 지켜지는가"** 는
별도의 공학 문제이며, 두 실패가 독립적으로 존재한다: **발동 실패**와 **실행 실패**.

#### 4.13.1 양 런타임 공통분모 (SSOT의 실제 구속 조건)

| 항목                      | 결론                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| description 길이          | **1024자 이하** (Codex 스펙 하드 리밋이 구속)                                                                    |
| `when_to_use` 필드        | **미사용** — Claude 전용. 트리거 어휘는 전부 description 본문에                                                  |
| 리스팅 예산               | 양쪽 다 초과 시 **뒤쪽부터 잘린다** → 핵심 트리거를 앞 100자에                                                   |
| `context: fork`, `paths:` | **금지** — Codex 미이식                                                                                          |
| Claude 전용 키            | 넣어도 무해하나 **기능이 의존하면 안 됨**. 자동발동 차단은 frontmatter + `agents/openai.yaml` 사이드카 양쪽 필요 |
| frontmatter 문법          | **한 줄 평문 스칼라**. 블록 스칼라(`>`,`                                                                         | `) 지양 — Prettier 리포맷이 로더를 깬 사례 다수. 포맷터에서 스킬 경로 제외 |

#### 4.13.2 description 규칙 (발동 실패 방어)

650-trial 요인설계 실측: 수동형 서술("Use when creating...") 발동률 **37~87.5%**,
지시형("**ALWAYS invoke** this skill when... Do not X directly") **94.4~100%**, 오즈비 20.6.
특히 **훅이 붙은 환경에서 수동형은 37%로 붕괴** — 우리 하네스가 정확히 그 조건이다.

단, superpowers의 반대 근거도 채택: **description에 내부 워크플로를 요약하면 안 된다.**
실제 사례 — description에 "2단계 리뷰"라 요약했더니 에이전트가 본문을 건너뛰고 1회만 수행.
**요약된 description은 본문을 건너뛰는 지름길을 만든다.**

→ 합성 규칙: **"언제/무조건"은 강하게, "어떻게"는 0.**

```
description 4요소 (≤1024자)
1. 도메인 + 지시형: "<도메인> 담당. 사용자가 <A/B/C>를 요청하면 ALWAYS 이 스킬을 먼저 호출한다"
2. 트리거 어휘 나열: 한/영 동의어, 축약형 (사용자가 실제로 칠 말)
3. 형제 스킬 경계: "이미 요구가 확정됐으면 route를 쓴다"  ← 7개 상호 과발동 방지에 필수
4. 대체행위 차단: "이 단계를 건너뛰고 바로 구현하지 마라"
✗ 내부 단계 요약 금지
```

⚠ **7개 전원 "ALWAYS invoke"는 상호 과발동 위험** — 650-trial은 독립 스킬 대상이었다.
지시형은 반드시 형제 경계 문장과 짝지어야 한다.

자동/수동 판정: 자동 허용 = `req-capture`·`route`·`context`·`verify-plan`·`retro` /
수동 전용(부작용 통제) = `handoff` / `adapt`는 자동이되 "route 이후에만" 경계 명시.

#### 4.13.3 구조 규칙

- SKILL.md **≤500줄(스펙), 목표 150줄·8KB**. 상시 진입점(`req-capture`·`route`)은 200단어급
- 디렉터리명 == `name` (소문자·하이픈, 연속 하이픈 금지)
- **gotchas는 반드시 인라인** — 별도 파일은 "언제 읽어야 하는지"를 에이전트가 못 알아챈다
- 분리 파일은 **로드 조건문 형태**로만 링크: ✗"자세한 건 references/ 참고"
  ✓"API가 200이 아닌 코드를 반환하면 `references/api-errors.md`를 읽어라"
- 스크립트는 `scripts/` 상대경로 + **"`--help`부터 실행, 소스를 읽지 말고 블랙박스로 호출"**
  명시 (컨텍스트 오염 방지 — 공식 webapp-testing 스킬의 규범)

#### 4.13.4 실행 준수 규칙 (발동 ≠ 준수)

**컨텍스트 생명주기 사실 2개가 설계를 좌우한다**:
- 렌더된 SKILL.md는 메시지 1개로 들어와 세션에 남고 **재독되지 않는다**
  → 작업 내내 적용될 규칙은 "1단계에서 ~하라"가 아니라 **상시 지침**으로 쓴다
- 오토컴팩션 시 스킬당 **앞 5,000토큰만**, 총 **25,000토큰** 예산으로 최근 호출부터 재부착
  → **오래된 스킬은 증발한다.** `handoff`·`retro`는 **컴팩션 이후 재호출을 전제**로 설계

**형태를 실패 유형에 맞춘다** (head-to-head 실험 근거):

| 베이스라인 실패      | 맞는 형태                                 | 틀린 형태                   |
| -------------------- | ----------------------------------------- | --------------------------- |
| 알면서 규칙 위반     | 금지 + 합리화 반박 표                     | 부드러운 권고               |
| 출력 **모양**이 틀림 | **긍정 레시피**(출력이 무엇인지 순서대로) | **금지 목록** ← 역효과 실측 |
| 필수 요소 누락       | 템플릿 안 REQUIRED 슬롯                   | 산문 리마인더               |
| 조건부 동작          | 관측 가능한 술어 조건문                   | 무조건 규칙 + 예외 조항     |

⚠ **뉘앙스·예외 조항 금지**: "중요하지 않으면 X 하지 마라"는 협상을 재개시킨다.
실험에서 승리한 레시피에 뉘앙스 조항 하나를 붙이자 일관성이 노이즈로 퇴화했고,
**금지형 arm은 무가이드 대조군보다도 나빴다.** 예외가 필요하면 문구가 아니라 **구조**를 바꾼다.

강제 기법: 체크리스트 상단에 `IMPORTANT: 아래 각 항목마다 todo를 만들어라` +
**가시적 산출물 계약**("이 블록을 출력하기 전엔 다음 단계로 넘어가지 마라") +
검증 통과 전 진행 금지. 절대 규칙은 스킬 텍스트가 아니라 **훅으로** (§0.2 계층).

#### 4.13.5 안티패턴 (커뮤니티 스킬 214개 중 73%가 60점 미만)

- **베이스라인 대조 필수**: 스킬 끈 상태로 같은 프롬프트를 돌려본다. **차이 없으면 만들지 않는다**
  (cheapest-signal-first의 스킬 버전 — 존재 가치 없는 스킬이 컨텍스트만 먹는다)
- 문단마다 "이게 없으면 에이전트가 틀리나?" — 통과 못 하면 삭제
- 옵션 나열 금지 → **기본값 1개 + 탈출구 1개** (메뉴를 주면 헤맨다)
- 트레이스에서 읽는 3증상: 여러 시도 후 성공=지침 모호 / 무관한 지침 따름=범위 과대 / 헤맴=기본값 부재
- flowchart는 **분기 결정에만**(route). 레퍼런스는 표, 코드는 코드블록, 선형 지시는 번호목록
- 서사형·다언어 예제·의미 없는 라벨 금지. **좋은 예제 1개 > 평범한 예제 여럿**

#### 4.13.6 스킬 vs 서브에이전트 vs 커맨드

**커맨드는 스킬로 병합됐다**(공식) — `.claude/commands/x.md`와 `.claude/skills/x/SKILL.md`는
동일 동작, 스킬이 권장. 실질 선택 축은 "누가 부르나"(자동/수동)와 "어디서 도나"(인라인/격리).

**7개 판정: 전부 스킬, 서브에이전트 0개.** `context: fork`와 서브에이전트는 Claude 전용이라
SSOT에 넣을 수 없다 — SKILL.md에는 절차만 쓰고, 서브에이전트 위임은 "가능하면" 수준의
선택적 표현으로만 (§4.4 팩 조립 등).

#### 4.13.7 저작 워크플로 (P1에서 이 순서로)

```
RED   — 스킬 없이 실제 프롬프트 3개 실행, 베이스라인 실패를 관찰·기록. 차이 없으면 만들지 않는다
GREEN — 템플릿대로 ≤150줄 작성. 관찰된 실패만 정면으로 겨냥 (가상 케이스 금지)
측정  — ① 발동: 쿼리 20개(발동 10/미발동 10) × 3회, train 60%/validation 40% 분할,
          validation 통과율로 버전 선택 (마지막 버전이 최선이 아닐 수 있다)
        ② 실행: on/off 산출물 비교, 트레이스에서 단계 누락 확인
        ③ **Codex에서 동일 쿼리 재측정** ← matcher가 달라 SSOT의 진짜 리스크
REFACTOR — 새 합리화 발견 시 명시적 반박 추가 후 재측정. 7개 상호 과발동 확인
```

**분산도 자체가 지표**: 5회 반복이 같은 모양으로 수렴하면 먹힌 것,
5가지 해석이 나오면 문구에 구속력이 없는 것.

### 4.14 병렬 운영·실패 복구 (v7) — 대부분 기존 컴포넌트 확장

조사 결론: **병렬 오케스트레이션 기계장치는 코어에 불필요하다.** REQ-first 단일 슬라이스 +
세션별 handoff + git 체크포인트가 이미 충돌 클래스(파일·공유상태·미커밋 유실)를 무력화하고,
**worktree 격리 자체가 현재 양 도구 모두에서 신뢰할 수 없기** 때문이다.

#### 4.14.1 worktree 병렬은 "무료 격리"가 아니다 (실측 반증)

| 이슈                  | 내용                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| claude-code #77268    | worktree 재활용이 **다른 살아있는 세션의 worktree를 삭제**, `git worktree lock` 무시, **미커밋/untracked 파괴** |
| #74726                | `isolation:"worktree"` 서브에이전트가 절대경로로 **worktree 밖 메인 체크아웃에 Write 성공**                     |
| #76197                | 실행 중 cwd가 메인 리포로 **조용히 드리프트** → 커밋이 엉뚱한 곳에 착지                                         |
| codex #19647 / #11435 | worktree 간 컨텍스트 누수 / 세션 디렉토리 미분리 시 `~/.codex/` 공유 오염                                       |

**Codex에는 내장 worktree가 없다** — 수동 `git worktree add` + `CODEX_HOME` 분리 필요.

→ **코어 반영 없음.** `docs/OPERATIONS.md`에 트러블슈팅 1절만: 버전 확인, `.worktreeinclude`로
`.env` 반입, **`git worktree lock`을 믿지 말 것**, 세션 종료 전 반드시 커밋.
`session-start` 훅에 저비용 조기경보 1줄: cwd가 worktree 하위인데 handoff 경로가 메인을
가리키면 경고(#76197·#74726 대응).

#### 4.14.2 병렬 손익분기 — 병목은 생성이 아니라 리뷰

1차 측정: Anthropic C 컴파일러 실험(16 에이전트/~2,000 세션/$20,000)은 파일 락으로 조정에
성공했으나, **리눅스 커널 컴파일이라는 단일 병목 과제에서 "모든 에이전트가 같은 버그를 만나
각자 고치고 서로를 덮어썼다"**. LinearB(810만 PR/4,800 조직): AI 생성 PR은 초기 리뷰 대기
**4.6배**, 수정 없는 수락률 **32.7%**(인간 84.4%), 고도입 팀은 PR 98%↑ 이지만 **리뷰 시간 91%↑**.

→ **병렬 상한은 "사람 리뷰어 수" 이하.** 소규모 팀에서 동시 REQ 2개면 충분하며,
강제 장치는 만들지 않는다(운영 규약으로 족함).

**병렬 불가 작업**: 같은 파일, DB 스키마 마이그레이션, 공유 타입·유틸, 의존 관계 있는 작업,
**단일 병목 버그**(위 커널 사례), 대규모 크리티컬 리팩토링.

#### 4.14.3 실패 복구 원칙

**"에이전트의 최종 메시지는 증언이지 증거가 아니다"** — §4.10.2 자기채점 금지의 외부 근거.
사후 검사는 요약이 아니라 `git status`/`diff`/테스트 출력을 직접 본다.

- **handoff 고정 3필드**: 목표(REQ) / 마지막 체크포인트 커밋 / 미완료 잔여
- **미커밋 자동 기록**: `handoff-check` 훅이 `git status --porcelain`이 비어있지 않으면
  파일 목록을 handoff에 기록 (비용 사다리 1단계 — LLM 판단 불필요)
- **reflog는 커밋된 것만 구한다** → 되돌리기 비싼 작업(대규모 리팩토링·`reset`·worktree 제거)
  전에는 WIP 커밋 필수. #77268(미커밋 파괴)과 직결되는 실효 안전장치
- **도구 전환(Claude↔Codex) 시 WIP 커밋으로 경계 표시** — 두 도구가 같은 브랜치에서
  미커밋 상태를 공유하지 않는다
- 자동 WIP 커밋 도구(git-stint 등)는 **미채택** — REQ 커밋 불변식과 충돌. 목록 기록으로 충분

#### 4.14.4 근본원인 7분류 (retro 스킬의 기록 스키마)

Microsoft AgentRx(실패 국소화 +23.6%p) 의 분류학만 차용:
**model / prompt / tool / environment / policy / verification / human-handoff**

§4.10.5 Sign 포맷에 `Cause:` 필드로 추가. **분류가 수정 대상 컴포넌트를 결정론적으로 지정**한다 —
`prompt`면 AGENTS.md로, `verification`이면 verify 게이트로, `tool`이면 훅으로.
AgentRx 런타임(제약 자동 합성 + LLM 판정)은 **미이식** — §0.2 반증 1(LLM 판정자 환각)의 정확한 반례 유형.

원칙: **"포스트모템은 하나가 바뀌기 전에는 끝나지 않는다."** 다음 실행이 같은 방식으로
실패할 수 있다면 문서만으로는 부족하고, 하네스에 내구성 있는 수정이 착지해야 한다.

#### 4.14.5 에스컬레이션 — 사람 개입 임계 (루프 종료와 별개 층)

`templates/req.yaml`에 **`escalate_after: 3`**: 같은 REQ에 verify 실패가 3회 누적되면
REQ를 `blocked`로 전이 + 사유 기록 + **작업 중단**. 근거는 3-strike 규칙(Ctrl-Z 논문의
"3회 후 사람 위임" 프로토콜, 봇 지원 업계 표준). §4.10.4의 루프 서킷브레이커와 달리
**대화형 세션에서도 작동**해야 하는 층이다.

미채택: 평판 가중 임계·신뢰도 스코어링·SLA 신호 — 과잉이고 LLM 판정이 필요해 §2.0 위반.
irreversibility 트리거는 §4.11 권한(deny·승인 요구)에 이미 존재하므로 중복 구축 안 함.

---

## 5. 팀 배포 (D4)

- **설치**: `npx <ariadne-repo> install` — 멱등. 글로벌 설정 포인터 주입은 물어보고 진행 (D3)
- **언인스톨/eject** (리뷰 4-2): `uninstall` 이 manifest 기반으로 생성 파일 제거,
  글로벌·프로젝트 각각 지원. 채택이 선택이려면 탈퇴 경로가 채택 경로만큼 명확해야 한다
- **온보딩**: 설치 → `/adapt` → 첫 REQ 완주. 목표 시간은 P6에서 실측 후 문서에 기재
  (5분은 목표지 약속이 아니다)
- **업데이트 전파**: pull → install → 각 프로젝트는 session-start 훅이 stale을 알리고
  `/adapt --refresh` 유도. install이 알려진 프로젝트 목록(글로벌 레지스트리)에 일괄
  재생성을 제안 (리뷰 2-3)
- **시크릿 정책**: 리포·글로벌 계층 시크릿 0. wrapper·decisions.md 커밋,
  handoff/는 로컬(gitignore 기본)
- **버전**: 리포 태그 = 하네스 버전. 코어·wrapper·프로젝트 핀 3곳에 스탬프

---

## 6. 구현 로드맵

| 단계                                         | 내용                                                                                                                                                                                                                                           | 완료 기준                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **P0 베이스라인 + 권한 실측**                | ① 팀 표준 CLI 최소 버전 확정 ② 두 CLI에서 코어 규칙 로드·스킬 발동·훅 발화 스모크 ③ **권한 실측 3종**: Codex approval_policy 준수 여부(codex#11885), deny가 `npx`/`docker exec` 경유를 못 막는 것 확인, `/hooks`+`--debug`로 훅 등록·발화 확인 | 위 항목이 실물로 확인되고 ONBOARDING에 최소 버전·trusted project 승인 절차 기재                   |
| P1 코어 규칙                                 | AGENTS.core.md + REQ 템플릿 + req-capture/route (**§4.13 RED→GREEN→측정 워크플로 준수**)                                                                                                                                                       | REQ 상태기계로 작업 1개 완주 + 질문 1개 규칙 준수 + **발동률 측정을 양 CLI에서 각각 통과**        |
| P2 생성기                                    | 템플릿 치환 생성기 + check-mirror(self-check) + install/uninstall                                                                                                                                                                              | 생성→검사 왕복 green, 멱등성·언인스톨 테스트, **CI(글로벌 설치본 없는 환경)에서 self-check 통과** |
| P3 메모리·컨텍스트                           | scrub·context-pack·budget + context/handoff 스킬                                                                                                                                                                                               | scrub 패턴 전수 유닛테스트(+오탐 치환 경로), 팩 조립 서브에이전트 위임 확인                       |
| P4 게이트·훅                                 | verify + 캡 산정 + commit/handoff/session-start 훅                                                                                                                                                                                             | 이 리포 verify green (dogfood) + 브라운필드 캡 산정 시뮬레이션                                    |
| P5 adapt                                     | adapt SKILL.md + Generated 블록 + manifest                                                                                                                                                                                                     | 원본 3프로젝트 중 1곳(브라운필드, 기존 CLAUDE.md 존재)에서 adapt→refresh→uninstall 왕복 성공      |
| P6 배포                                      | ONBOARDING/OPERATIONS + 모듈 문서                                                                                                                                                                                                              | 신규 머신 클린 설치 → 문서만으로 첫 REQ 완주, 소요 시간 실측 기재                                 |
| P7 루프 모듈 (옵션, P4 이후)                 | `modules/loop/` — **프로세스 재시작 방식**(공식 플러그인의 세션 유지 방식은 비판 수용해 배제) + 종료 3계층 + 테스트 보호 훅                                                                                                                    | 소형 REQ 3개 목표 자율 완주, 예산·stall 종료 각 1회 실증                                          |
| **P8 하네스 평가** (신설 — 효과 회의론 대응) | 고정 REQ 태스크 3~5개 + frozen 채점 기준(content-hash) + 하네스 버전만 변인. 채점 축 = 정확도 + 토큰 소비                                                                                                                                      | 하네스 on/off 비교 1회 완주, 수치가 문서에 기록됨. 이후 분기별 실행                               |

각 단계는 REQ-first로 진행 (dogfood).

---

## 7. NOT in scope

- akasha/Parallax 코드 수정 — 옵션 모듈 연결만
- 기존 글로벌 환경 마이그레이션 — D3, 완성 후 사용자 판단
- atlas-code approval gate/훅 ledger **런타임** 이식 — 훅 계약 스키마만 참고.
  단 그 공백은 §4.3.1·§4.6·§4.7의 결정론 앵커가 메운다는 것이 v2의 입장 (리뷰 뿌리 지적 반영)
- 자체 에이전트 루프/런타임
- CI 벤더 종속 기능 — 분리 보고 원칙만 채택
- 코어에서의 반복 실패 감지 — retro는 기록만, 감지는 akasha 모듈 전용 (리뷰 5-4)

## 8. 리스크

| 리스크                                                                                | 완화                                                                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| REQ-first 사문화 (리뷰 5-2) — 업계는 차등 게이트 권고하나 D10에서 전면 적용 재확인    | §4.3.1 커밋 불변식 — 양 에이전트 훅 + verify 3중 집행. REQ 타임스탬프 집계로 마찰 실측, 데이터가 쌓이면 재논의 |
| Codex 소비 표면 가설 오류                                                             | v3에서 문서+실측으로 해소. 잔여: 팀 머신 버전 스큐 → P0 버전 베이스라인                                        |
| Codex 훅 도입 버전 불명                                                               | P0에서 팀 최소 버전 확정, 구버전은 verify 폴백 명시                                                            |
| wrapper drift / 버전 스큐                                                             | 스탬프 self-check(CI 가능) + freshness 분리 + session-start advisory                                           |
| 서드파티 wrapper 포맷 변화                                                            | 불투명 템플릿으로 흡수 지점 국소화 (리뷰 5-1)                                                                  |
| adapt 재실행·브라운필드 파손                                                          | Generated 블록 마커 + manifest + 백업. P5 왕복 테스트가 완료 기준                                              |
| scrub 오탐으로 데이터 유실                                                            | 치환-후-저장 + advisory (리뷰 3-3)                                                                             |
| 병존 기간 컨텍스트 이중 로드                                                          | §2.2에 명시 — 효율 목표는 전환 후. adapt가 충돌 감지·보고                                                      |
| 훅 오활성화 세션 잠김 / 무한 차단                                                     | opt-in sample 3중 명시 + `stop_hook_active` 체크 + 자체 반복 카운터 (#55754 실증)                              |
| **훅 조용한 미발화** — 규칙이 죽은 줄도 모름 (#74942)                                 | 훅 발화 로그 감사 + CI 백스톱 (§0.2 D15)                                                                       |
| **에이전트의 훅 우회 학습** (#40117)                                                  | CI/브랜치 보호를 최종 강제선으로 + 명시적 탈출구 제공                                                          |
| **파일 메모리 stale 오염** — 이 분야 최빈 실패 모드                                   | 날짜 스탬프 + 자동 아카이브 + 팩 조립 시 만료 제외 + 내장 memory 병행 금지                                     |
| **하네스 투자가 효과 없을 가능성** (METR 19% 지연 실측)                               | P8 평가로 측정. 수치가 안 나오면 하네스를 줄인다                                                               |
| **프롬프트 인젝션** — 공개 이슈 하나로 토큰 유출 실사례(2026)                         | 네트워크 egress 최소화 + `.env` deny + bypass 금지. 단 `github.com` 허용 자체가 유출 경로로 남음(잔여 위험)    |
| **deny 규칙 우회** — npx/docker exec/직접 파일 열기                                   | OS sandbox 계층(§4.11.5). 문자열 계층은 조기경보로만 취급                                                      |
| Codex approval_policy 미준수 의혹(codex#11885)                                        | P0 실측 항목. 미준수 확인 시 sandbox_mode를 read-only로 강화                                                   |
| **병렬 확대 시 리뷰 병목** — AI PR 리뷰 대기 4.6배, 리뷰 시간 91%↑ (LinearB 810만 PR) | 병렬 상한 = 리뷰어 수 이하. 동시 REQ 2개 기준                                                                  |
| **worktree 격리 불신** — 재활용이 미커밋 파괴(cc#77268), 격리 밖 쓰기(#74726)         | 코어 미사용. 쓸 경우 종료 전 커밋 필수 + OPERATIONS 트러블슈팅                                                 |
| append-only 무한 축적                                                                 | §4.3 아카이브 규약을 초기부터 적용 (리뷰 5-3)                                                                  |
