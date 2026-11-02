<div align="center">

<img src="docs/assets/ariadne-mark.svg" width="96" height="96" alt="Ariadne의 실" />

# Ariadne

**도구를 바꿔도, 작업의 실은 이어지도록.**

A portable coding-agent harness for requirements, context, and evidence.

[![Verify](https://github.com/YouSangSon/ariadne/actions/workflows/verify.yml/badge.svg)](https://github.com/YouSangSon/ariadne/actions/workflows/verify.yml)
![Node.js 24.22+](https://img.shields.io/badge/Node.js-24.22%2B-43853d?logo=nodedotjs&logoColor=white)
![Dependencies: zero](https://img.shields.io/badge/runtime_dependencies-0-eab308)

[시작하기](#시작하기) · [온보딩](docs/ONBOARDING.md) · [실행 정책](docs/execution-policy.md) · [설계](docs/unified-execution-design.md)

</div>

---

세션이 바뀔 때마다 목표를 다시 설명하고, 이전 결과를 찾아 옮기고, 테스트가 정말 통과했는지 확인하는 일.
Ariadne는 이 수고를 줄이기 위한 **개인 프로젝트용 코딩 에이전트 하네스**입니다.

요구사항에서 시작해 작업 문맥과 검증 기록을 이어 줍니다. 이름은 미궁에서 돌아올 길을 알려 준 아리아드네의 실에서 가져왔습니다.

## 현재 사용할 수 있는 것

| 기능 | 실제 동작 |
| --- | --- |
| **REQ 기반 작업** | 목표·수용 기준·제약·검증 명령을 하나의 요구사항 문서로 유지 |
| **필수 문맥 보존** | 확정 사실과 verification을 우선 보존하고, 필수 정보가 예산을 넘으면 출력 없이 실패 |
| **공통 규칙·스킬** | 원본 하나에서 Codex·Claude Code용 미러 생성 및 일치 검사 |
| **변경 감지 기반 요소** | 모든 AC와 불변 scope를 묶은 계약 해시, dirty·untracked·mode를 포함하는 소스 지문 |
| **제한된 파일 도구** | 경로·symlink·시크릿·크기·기존 SHA 검사와 임시 파일을 통한 교체 |
| **API 전송 기반 요소** | Chat Completions 호환 요청·도구 응답 검증·redirect 차단·명시적 오류 분류 |

> **개발 중인 경계:** 작업 DB·dispatcher·자동 재개·실행 풀·완료 봉인은 아직 공개 실행 기능이 아닙니다.
> 이 저장소는 검증한 컨텍스트 보완과 연결 기반 요소까지 게시한 체크포인트입니다.
> API 전송 모듈의 존재가 자동 코딩 루프나 네이티브 CLI의 무인 실행을 뜻하지 않습니다.

## 시작하기

추가 npm 패키지 없이 실행합니다. 전체 공개본 검증 기준은 **Node.js 24.22 이상**입니다.

```sh
git clone https://github.com/YouSangSon/ariadne.git
cd ariadne
node scripts/verify.mjs
```

공통 규칙과 스킬을 독립 설치 경로에 복사합니다.

```sh
node scripts/install.mjs
```

기존 글로벌 설정은 `--global-pointer`를 선택한 경우에만 연결합니다.
프로젝트 적용과 제거 절차는 [온보딩](docs/ONBOARDING.md)과 [운영 가이드](docs/OPERATIONS.md)를 따릅니다.

## 규칙과 실행기의 책임

| 대상 | Ariadne의 역할 | 별도로 유지되는 것 |
| --- | --- | --- |
| **Codex · Claude Code** | 공통 작업 규칙·요구사항·문맥 전달 | 각 도구의 로그인·세션·실행 권한 |
| **Gemini** | 선택 가능한 수동 인수인계 패킷 기반 요소 | 사용자의 CLI 설치·인증·실행 |
| **모델 API · Grok 등** | 호환 HTTP 전송과 제한 도구 형식 | 별도 API 인증·요금·실제 공급자 호환성 검증 |

단일 도구만 사용해도 됩니다. 여러 도구를 연결해도 인증이나 구독을 하나로 합치지 않습니다.
유료 공급자 실호출·네이티브 자동 실행·OS 수준 프로세스 격리는 검증하지 않았습니다.

## 작은 하네스, 확인할 수 있는 규칙

- 필수 문맥을 먼저 보존합니다. 긴 선택 노트 때문에 검증 계약이 사라지지 않게 합니다.
- 잘못된 REQ ID·상태·중복 AC·지원하지 않는 문법은 명시적으로 거절합니다.
- 파일 내용뿐 아니라 경로·종류·mode와 미추적 변경도 소스 지문에 반영합니다.
- 실제 실패에 대응하는 검사와 가드를 남깁니다. 규칙 수나 에이전트 수를 목표로 삼지 않습니다.
- 모델의 완료 선언, 로컬 검사, 원격 CI, 실서비스 운영 결과를 구분합니다.

`AGENTS.md`는 일하는 규칙을 전달합니다. 스크립트와 테스트는 결정론적으로 검사할 수 있는 부분을 담당합니다.
지침 파일만으로 백그라운드 이벤트 수신이나 자동 복구가 생기지는 않습니다.

## 검증

```sh
node scripts/verify.mjs
node --test tests/context-pack.test.mjs tests/loop-*.test.mjs
```

검사는 실제 파일과 이번 테스트가 띄운 HTTP 서버를 사용합니다. 모델 호출은 필요하지 않습니다.
API 프로토콜 검사를 모델 품질·구독 절감률·실서비스 성능의 근거로 해석하지 않습니다.
파일 SHA 검사와 rename 사이의 임의 외부 writer 경쟁은 보장하지 않으므로 독립 작업 공간이 필요합니다.

<details>
<summary><strong>저장소 길잡이</strong></summary>

| 위치 | 역할 |
| --- | --- |
| `core/AGENTS.core.md` | 짧은 공통 규칙 원본 |
| `skills/` | 요구사항·라우팅·문맥·인수인계 스킬 원본 |
| `.agents/`, `.claude/` | 도구별 생성 미러 |
| `lib/`, `scripts/`, `tests/` | 결정론 검사와 회귀 근거 |
| `modules/loop/` | 계약·파일 도구·전송·수동 인수인계 기반 요소 |
| `evaluation/` | 모델 호출 없는 평가 장치의 제어군 |

프로젝트 이름과 저장소 경로는 **Ariadne / `ariadne`**입니다.
기존 설치 데이터 형식 `.harness/`, `~/.harness`, `harness-*` 식별자는 유지합니다.
공개본은 회사 이메일·비공개 로컬 경로와 이전 비공개 Git 이력을 제외한 별도 스냅샷입니다.

</details>

---

**Read the intent. Keep the thread. Verify the result.**
