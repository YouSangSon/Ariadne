<div align="center">

<img src="docs/assets/ariadne-mark.svg" width="96" height="96" alt="Ariadne의 실" />

# Ariadne

**원하는 일을 끝낼 때까지, 작업의 실을 잇습니다.**

An integrated agent harness for goals, context, tools, and verified outcomes.

[![Verify](https://github.com/YouSangSon/Ariadne/actions/workflows/verify.yml/badge.svg)](https://github.com/YouSangSon/Ariadne/actions/workflows/verify.yml)
![Node.js 24.22+](https://img.shields.io/badge/Node.js-24.22%2B-43853d?logo=nodedotjs&logoColor=white)

[한국어](README.md) · [日本語](README.ja.md) · [English](README.en.md) · [简体中文](README.zh-CN.md)

[제품 방향](docs/product-direction.md) · [현재 기능](#features) · [시작하기](#getting-started) · [실행 정책](docs/execution-policy.md)

</div>

한국어 README를 기준으로 네 언어의 구성·명령·지원 범위를 함께 갱신합니다. 연결된 상세 문서는 한국어 또는 영어로 제공됩니다. README 번역은 CLI의 표시 언어 지원을 뜻하지 않습니다.

---

Ariadne는 **사용자의 목표를 실행과 검증으로 잇는 통합 에이전트 하네스**입니다.

사용자가 원하는 일을 맡기면, 필요한 문맥·도구·실행기를 연결하고 결과를 확인하는 것이 목표입니다.
코딩, 조사, 문서 작성, 분석, 반복 업무를 같은 작업 흐름으로 다루는 방향을 지향합니다.

매번 목표를 다시 설명하거나 같은 자료를 다시 찾고, 실패 원인도 모른 채 호출을 반복하는 낭비를 줄이는 데 초점을 둡니다.
필요한 정보와 검증은 유지하면서 **원하는 결과를 얻는 데 드는 전체 모델 사용량**을 줄이는 것이 기준입니다.
아직 범용 작업을 자동 완주하는 실행기는 제공하지 않습니다. 현재 기능과 구현 우선순위는 아래와 [제품 방향](docs/product-direction.md)에서 구분합니다.

<a id="workflow"></a>

## 지향하는 작업 흐름

1. 원하는 결과와 완료 조건을 이해합니다. 이미 확인한 내용은 다시 묻지 않습니다.
2. 관련 문맥과 이전 근거를 찾아 작업에 필요한 만큼 전달합니다.
3. 권한·예산·필수 기능에 맞는 도구와 실행기를 선택합니다.
4. 수행 결과를 확인하고, 중단되면 확인한 상태에서 이어 갑니다.

이 흐름은 제품 목표입니다. 현재는 요구사항·문맥·기억·도구 연결의 기반을 제공하며 자동 배정·실행·재개는 개발 중입니다.

<a id="features"></a>

## 현재 사용할 수 있는 것

| 기능 | 실제 동작 |
| --- | --- |
| **REQ 기반 작업** | 목표·수용 기준·제약·검증 명령을 하나의 요구사항 문서로 유지 |
| **필수 문맥 보존** | 확정 사실과 verification을 우선 보존하고, 필수 정보가 예산을 넘으면 출력 없이 실패 |
| **영속 메모리** | PostgreSQL 원본·Qdrant/pgvector 검색, 조직별 권한과 HTTP·MCP 도구 |
| **코드 영향 분석** | 로컬 SQLite 그래프, 변경 영향·검증 대상·근거와 MCP·UI |
| **지식 관계** | 작업 기록의 위키 승격과 링크·미해결 관계 인덱스 |
| **공통 규칙·스킬** | 원본 하나에서 Codex·Claude Code용 미러 생성 및 일치 검사 |
| **변경 감지 기반 요소** | 모든 AC와 불변 scope를 묶은 계약 해시, dirty·untracked·mode를 포함하는 소스 지문 |
| **제한된 파일 도구** | 경로·symlink·시크릿·크기·기존 SHA 검사와 임시 파일을 통한 교체 |
| **API 전송 기반 요소** | Chat Completions 호환 요청·도구 응답 검증·redirect 차단·명시적 오류 분류 |

> **개발 중인 경계:** 작업 DB·dispatcher·자동 재개·실행 풀·완료 봉인은 아직 공개 실행 기능이 아닙니다.
> 이 저장소는 검증한 컨텍스트 보완과 연결 기반 요소까지 게시한 체크포인트입니다.
> API 전송 모듈의 존재가 범용 작업의 자동 완주나 네이티브 CLI의 무인 실행을 뜻하지 않습니다.

<a id="getting-started"></a>

## 시작하기

전체 제품은 **Node.js 24.22.2 이상**에서 설치·실행합니다. 파일 기반 코어는 외부 DB 없이 사용할 수 있고, 영속 메모리 서비스는 PostgreSQL과 선택한 벡터 저장소가 필요합니다.

```sh
git clone https://github.com/YouSangSon/Ariadne.git
cd Ariadne
npm run setup
npm run verify
node bin/Ariadne.mjs --help
```

현재 제공하는 코드 분석과 문맥 명령은 작업할 저장소에서 실행합니다.

```sh
node /path/to/Ariadne/bin/Ariadne.mjs code init
node /path/to/Ariadne/bin/Ariadne.mjs code index
node /path/to/Ariadne/bin/Ariadne.mjs code analyze --changed src/example.ts --fail-on none
node /path/to/Ariadne/bin/Ariadne.mjs context --root . --req my-task
```

메모리는 `packages/memory/.env.example`을 루트 `.env`로 복사하고 DB·벡터 설정을 확인한 뒤 사용합니다. 실제 값은 Git에서 제외합니다. 기본 transformer 모델은 로컬에서 실행하며 첫 실행에 가중치를 내려받을 수 있습니다. API 키나 유료 공급자는 자동 설정하지 않습니다.

```sh
node --env-file=.env bin/Ariadne.mjs memory serve
node --env-file=.env bin/Ariadne.mjs memory mcp
```

클라이언트 연결과 저장소 설정은 [설정·운영 안내](docs/consolidation.md#runtime-directories-and-agent-clients)를 따릅니다.

공통 규칙과 스킬을 독립 설치 경로에 복사합니다.

```sh
node scripts/install.mjs
```

기존 글로벌 설정은 `--global-pointer`를 선택한 경우에만 연결합니다.
프로젝트 적용과 제거 절차는 [온보딩](docs/ONBOARDING.md)과 [운영 가이드](docs/OPERATIONS.md)를 따릅니다.

<a id="responsibilities"></a>

## 규칙과 실행기의 책임

| 대상 | Ariadne의 역할 | 별도로 유지되는 것 |
| --- | --- | --- |
| **Codex · Claude Code** | 공통 작업 규칙·요구사항·문맥 전달 | 각 도구의 로그인·세션·실행 권한 |
| **Gemini** | 선택 가능한 수동 인수인계 패킷 기반 요소 | 사용자의 CLI 설치·인증·실행 |
| **모델 API · Grok 등** | 호환 HTTP 전송과 제한 도구 형식 | 별도 API 인증·요금·실제 공급자 호환성 검증 |

단일 도구만 사용해도 됩니다. 여러 도구를 연결해도 인증이나 구독을 하나로 합치지 않습니다.
유료 공급자 실호출·네이티브 자동 실행·OS 수준 프로세스 격리는 검증하지 않았습니다.

<a id="principles"></a>

## 작은 하네스, 확인할 수 있는 규칙

- 필수 문맥을 먼저 보존합니다. 긴 선택 노트 때문에 검증 계약이 사라지지 않게 합니다.
- 잘못된 REQ ID·상태·중복 AC·지원하지 않는 문법은 명시적으로 거절합니다.
- 파일 내용뿐 아니라 경로·종류·mode와 미추적 변경도 소스 지문에 반영합니다.
- 실제 실패에 대응하는 검사와 가드를 남깁니다. 규칙 수나 에이전트 수를 목표로 삼지 않습니다.
- 모델의 완료 선언, 로컬 검사, 원격 CI, 실서비스 운영 결과를 구분합니다.

`AGENTS.md`는 일하는 규칙을 전달합니다. 스크립트와 테스트는 결정론적으로 검사할 수 있는 부분을 담당합니다.
지침 파일만으로 백그라운드 이벤트 수신이나 자동 복구가 생기지는 않습니다.

<a id="verification"></a>

## 검증

```sh
npm run verify
# 코어만 확인할 때
node scripts/verify.mjs
```

검사는 실제 파일·임시 프로젝트와 테스트가 띄운 HTTP 서버를 사용합니다. CI의 PostgreSQL·pgvector·로컬 transformer 검색 검증은 별도 작업으로 실행합니다. 모델 호출은 필요하지 않습니다.
API 프로토콜 검사를 모델 품질·구독 절감률·실서비스 성능의 근거로 해석하지 않습니다.
파일 SHA 검사와 rename 사이의 임의 외부 writer 경쟁은 보장하지 않으므로 독립 작업 공간이 필요합니다.

<a id="repository-guide"></a>

<details>
<summary><strong>저장소 길잡이</strong></summary>

| 위치 | 역할 |
| --- | --- |
| `core/AGENTS.core.md` | 짧은 공통 규칙 원본 |
| `skills/` | 요구사항·라우팅·문맥·인수인계 스킬 원본 |
| `.agents/`, `.claude/` | 도구별 생성 미러 |
| `lib/`, `scripts/`, `tests/` | 결정론 검사와 회귀 근거 |
| `packages/memory/`, `packages/code/` | 내부 구현·고정된 의존성·기존 계약과 테스트 |
| `bin/Ariadne.mjs` | 단일 설치·실행 진입점 |
| `modules/llm-wiki/` | 위키 승격과 관계 인덱스 |
| `modules/loop/` | 계약·파일 도구·전송·수동 인수인계 기반 요소 |
| `evaluation/` | 모델 호출 없는 평가 장치의 제어군 |

프로젝트 이름과 저장소 경로는 **Ariadne / `Ariadne`**입니다.
기존 설치 데이터 형식 `.harness/`, `~/.harness`, `harness-*` 식별자는 유지합니다.

</details>

---

**Read the intent. Keep the thread. Verify the result.**
