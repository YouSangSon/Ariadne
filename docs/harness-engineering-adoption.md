# 필요한 스킬만 읽고 실행 근거로 비교하기

20개 저장소에서 Ariadne에 적용할 기법을 조사했다. 이번에는 로컬 스킬의 선택적 로딩과 기록 기반 실행 비교를 구현한다. 저장소 전체나 외부 스킬을 설치하지 않으며, 자동 실행기를 활성화하지 않는다. 기존 사용자 지시·권한·필수 검증은 유지한다.

이 문서는 `c39065d`의 두 구현과 출처 검토 기록이다. 20개 저장소의 활용 범위가 이 두 기능으로 끝난다는 뜻은 아니다. 장점을 결합하고 약점을 보완하는 후속 구조·계약·검증 계획은 [하네스 합성 설계](harness-synthesis-design.md)가 소유한다. 후속 설계는 구현 완료 항목과 구분한다.

조사 기준은 2026-11-06에 확인한 공식 저장소의 HEAD, 라이선스, README와 구현·명세 파일이다. 아래 표의 SHA는 조회 시점의 원본을 고정한다. 목록의 작성자가 누구인지, 이들이 실제 사용량 기준 상위 20개인지까지는 확인하지 않았다. 별 수와 목록 등재는 품질 근거로 사용하지 않는다.

## 바로 사용하는 방법

대상 프로젝트의 `skills/<이름>/SKILL.md`에서 이름과 설명을 먼저 확인한다.

```sh
node /path/to/Ariadne/bin/Ariadne.mjs skills --root /path/to/project
```

결과의 `selection` 값을 복사해 필요한 스킬만 문맥에 넣는다. 아래 `선택값`은 목록이 반환한 `이름@64자리SHA256`으로 바꾼다.

```sh
node /path/to/Ariadne/bin/Ariadne.mjs context --root /path/to/project \
  --req my-task --skill 선택값 --budget standard
```

`--skill`을 반복하면 여러 스킬을 선택할 수 있다. 선택하지 않은 스킬의 본문은 읽어 넣지 않는다. `--req`는 기존 요구사항 문서가 있을 때 지정한다. 선택한 본문이 바뀌면 재선택해야 하며, 잘못된 옵션은 무시하지 않고 실패한다. 스킬 본문과 필수 요구사항이 함께 예산을 넘으면 stdout을 비운 채 실패한다. 스킬의 일부 지시만 잘라 넣지 않는다.

실행 기록 비교는 별도 명령이다.

```sh
node bin/Ariadne.mjs eval compare --file evaluation/comparison-example.json
```

예제는 **합성 데이터**다. CLI 사용과 집계 규칙을 보여줄 뿐 실제 모델의 품질이나 토큰 절약을 측정한 결과가 아니다. 실제 비교에는 동일 과제의 실행·검증 기록과 제공자가 관측한 사용량이 필요하다.

## 선택한 구조와 대안

전체 외부 스킬을 설치하면 호스트별 도구·모델·승인 규칙이 섞이고, 읽을 문맥도 늘어난다. 반대로 링크 모음만 추가하면 사용자가 다시 조사하고 수동으로 비교해야 한다. 따라서 기존 `modules/context`와 `evaluation`에 독립적인 로컬 기능을 넣는다. 새 서비스·DB·프레임워크는 추가하지 않는다.

| 판단 | 이번 구현 | 선택 이유와 한계 |
| --- | --- | --- |
| 스킬 발견 | `skillCatalog`가 메타데이터와 선택 hash를 반환 | 원문 출처를 따라가며 필요한 본문만 선택한다. 자동 관련성 분류나 추천 정확도를 보장하지 않는다. |
| 내용 고정 | `skillSelection`으로 slug와 SHA-256을 검증하고 같은 읽기 결과를 표시 | 선택 뒤 변경을 발견한다. hash는 안전성·저작권 허가·사용자 승인 증명이 아니다. |
| 문맥 조립 | `buildPack`과 `renderPack`의 기존 필수 예산 안에 본문 전체를 포함 | 기존 목표·제약·검증을 보존한다. 글자 수는 모델 토큰 수가 아니다. |
| 실행 비교 | `compareRuns`가 같은 사례를 양쪽 변형에 연결 | 다른 입력·모델·환경이나 빠진 기록을 개선 결과로 오인하지 않는다. 기록 자체의 진실성은 새로 인증하지 않는다. |
| 비용 판정 | 실패·오류·재시도를 포함한 전체 사용량을 집계 | 사용량 누락을 0으로 바꾸지 않는다. 성공이 없으면 성공당 비용은 정의하지 않는다. |
| 권한 | 선택한 내용은 신뢰되지 않은 참고 자료 | `allowed-tools`, 모델명, 명령문은 권한이나 실행 설정을 바꾸지 않는다. |

### 스킬 파일의 지원 범위

`modules/context/skills.mjs`는 `name`과 `description`의 단일 행 plain/따옴표 문자열만 읽는다. 폴더명과 name은 일치해야 한다. 필수 필드의 중복, alias·anchor·block scalar·여러 줄 표현은 거절한다. 선택한 메타데이터 부분집합이며 완전한 YAML 파서나 전체 Agent Skills 명세 구현이 아니다. 나머지 필드는 실행 설정으로 해석하지 않는다.

카탈로그는 `skills` 바로 아래 최대 100개 항목을 검사한다. 한 스킬은 최대 64 KiB이며 선택은 최대 20개다. `scripts`와 `references`를 자동으로 읽거나 실행하지 않는다. 목록은 본문을 출력하지 않지만, hash를 계산하기 위해 파일의 바이트는 내부에서 읽는다. 설명과 본문의 시크릿은 기존 scrub 규칙을 적용한다. hash는 scrub 이전 원문 바이트를 식별한다.

파일 adapter는 기존 `readProjectText`를 재사용한다. 정적 symlink, 보호 경로, 잘못된 UTF-8, 과대 파일을 거절한다. 신뢰할 수 있는 로컬 작업 공간을 전제로 하며, 다른 프로세스가 동시에 조상 디렉터리를 교체하는 공격까지 막는 OS sandbox가 아니다. 카탈로그와 실제 선택 사이의 내용 변경은 새 읽기의 hash로 검출한다.

규칙 설치본도 `lib/skill-catalog.mjs`와 context의 직접·간접 의존성을 manifest로 관리한다. 설치본에서 `node <prefix>/lib/skill-catalog.mjs --root <project>`와 기존 context 명령을 실행할 수 있다. 제거 시 사용자 스킬이나 다른 파일을 삭제하는 새 동작은 없다.

### 실행 비교의 신뢰 경계

하나의 `case_id`는 하나의 과제·반복 회차다. 같은 사례와 variant의 중복 기록은 거절한다. 반복 실험은 별도 case_id를 쓴다. 각 기록의 `attempts`에는 재시도까지 포함하며 마지막 시도의 outcome이 보고된 최종 결과다. pass에는 검증 결과의 `evidence_sha256`이 필요하지만, 그 hash만으로 실제 검증이 실행됐음을 인증하지는 않는다.

비교 조건은 입력·검사기·환경의 hash, 모델, effort다. 빠진 값끼리는 같다고 취급하지 않는다. 양쪽 사례 집합이 다르거나 변형 안의 하네스 hash가 섞이면 비교 가능하다고 판정하지 않는다. 같은 hash는 동일하다고 보고된 조건을 나타낼 뿐, 실험에서 하네스 이외의 모든 변수가 실제로 통제됐다는 인과 증명은 아니다.

알려진 과제의 오류·timeout·미확정 결과는 비용과 결과 분모에 남는다. 입력 토큰·출력 토큰·비용은 서로 독립적인 관측값이다. 사용량이 누락된 지표는 해당 집합 전체에서 `null`과 coverage로 보고한다. 제공자의 input/output 정의를 따라 기록하며 cached/reasoning 등 중복될 수 있는 하위 필드를 다시 합산하지 않는다. 비교 결과는 기술적 집계이며 자동 승자 선정·통계적 우월성·실제 절약률 보증이 아니다.

## 더 발전시킬 수 있는 적용

다음은 이번 기능과 기존 계약을 연결한 Ariadne 제안이다. 원본 저장소에 그대로 있는 기능이나 구현 완료 항목으로 표시하지 않는다.

1. **스킬을 빼 보는 실험.** 동일 작업을 전체 스킬 조합과 선택 조합으로 수행한 기록을 비교한다. 총 토큰만 보지 않고 사례별 품질 회귀와 실패 비용을 함께 확인한다. 이번 비교기가 그 보고 수단이며, 모델 실행·자동 선택은 아직 수행하지 않는다.
2. **출처가 바뀌면 재사용을 멈추는 근거.** 스킬 hash 고정과 기존 source/contract hash를 연결해 검사·문맥 재사용 조건을 정한다. 오래된 승인까지 재사용하지 않는다. 공통 Task의 완료 봉인은 기존 실행 설계에 남는다.
3. **코딩 밖의 근거 검증.** 조사·문서 작업에서도 최신 정정, 오래된 문서, 읽지 못한 자료를 구분하고 주장에 필요한 출처를 검사한다. 공개 benchmark 정답을 들여오는 대신 작은 자체 과제와 검사기를 만든다. 이번 합성 비교 예제는 보고 형식만 검증한다.
4. **실패 이유가 달라졌을 때만 재시도.** 기존 route 스킬의 실패 종류·바뀐 입력 기록을 활용한다. Ralph의 무조건 반복·completion 문자열 판정으로 대체하지 않는다. 자동 재시도 실행기는 이번 범위가 아니다.

## 검증과 전달 범위

AC1은 아래 20개 출처 표, AC2는 `tests/skill-catalog.test.mjs`, AC3은 `tests/evaluation-compare.test.mjs`, AC4는 기존 context·설치·root 검증으로 추적한다. 메모리·코드 패키지와 DB 계약은 이번에 수정하지 않는다. 기존 PR #5의 CodeQL 차단과 이번 로컬 기능 검증은 별개다. 보호 규칙 변경·원격 게시·유료 모델 호출을 포함하지 않는다.

최종 `node scripts/verify.mjs`의 소스 검사·미러 일치·커밋 REQ 검사를 통과했다. 실제 launcher의 스킬 목록·선택 문맥·합성 실행 비교와 설치본 의존성 경로도 확인했다. 독립 리뷰에서 발견한 식별자 비밀 노출·여러 줄 metadata·끊어진 symlink 처리는 실패 재현 후 보완했다. 20개 commit 고정 출처와 로컬 문서 링크를 대조했다. 변경하지 않은 memory/code 패키지의 기존 검증 근거는 재사용했으며 전체 패키지·DB 검사를 반복하지 않았다. 이번 변경의 원격 CI·실제 모델 사용량·실사용 품질 평가는 실행하지 않았다.

## 출처별 검토 기록

모든 행에서 공식 저장소의 README 외 파일도 확인했다. 목록형 저장소는 구현이 없다는 사실 자체가 검토 결과다. 라이선스는 조사 범위를 설명하며 전이 의존성·수집 콘텐츠 전체의 재사용 허가를 보장하지 않는다. 이번 변경은 기법을 참고한 자체 구현이며 외부 코드·스킬 본문·목록 데이터를 vendor하지 않는다.

| 공식 저장소와 고정 revision | 라이선스 | 확인 파일과 적용 판단 |
| --- | --- | --- |
| [anthropics/skills](https://github.com/anthropics/skills) · `ca45fc496a3436251f191354091d557da31c15b5` | 개별 적용; skill-creator Apache-2.0 | [skills/skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/ca45fc496a3436251f191354091d557da31c15b5/skills/skill-creator/SKILL.md) · 메타데이터→본문→참고 자료의 단계적 읽기와 기준선 비교를 채택. 문서 스킬 전체를 같은 라이선스로 가정하지 않는다. |
| [obra/superpowers](https://github.com/obra/superpowers) · `22f0b463e7a5e579904dd6211a520321035526f7` | MIT | [skills/verification-before-completion/SKILL.md](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/verification-before-completion/SKILL.md) · 완료 주장에 실행 근거를 요구하는 원칙 유지. 이미 유효한 전체 검사를 매번 다시 실행하는 정책은 복제하지 않는다. |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) · `6d483e29da745a010d88974ef6d0e50d15755e9a` | MIT | [CONTRIBUTING.md](https://github.com/VoltAgent/awesome-agent-skills/blob/6d483e29da745a010d88974ef6d0e50d15755e9a/CONTRIBUTING.md) · 4개 파일의 후보 링크 목록. 발견 경로로만 사용하며 연결 대상의 품질·허가를 별도 확인한다. |
| [agentsmd/agents.md](https://github.com/agentsmd/agents.md) · `d001185d792eb6402a58e4cbef1c228b309ec25d` | MIT | [components/FAQSection.tsx](https://github.com/agentsmd/agents.md/blob/d001185d792eb6402a58e4cbef1c228b309ec25d/components/FAQSection.tsx) · 가까운 지침과 사용자 지시의 범위를 존중. 문서 설명을 모든 호스트의 실제 강제 동작으로 확대하지 않는다. |
| [coleam00/context-engineering-intro](https://github.com/coleam00/context-engineering-intro) · `a2d84b021cee1e2f4e77ba854bba0be8cb319035` | MIT | [PRPs/templates/prp_base.md](https://github.com/coleam00/context-engineering-intro/blob/a2d84b021cee1e2f4e77ba854bba0be8cb319035/PRPs/templates/prp_base.md) · 목표·필수 자료·완료 기준·검증을 기존 REQ에 유지. 별도 PRP 정본을 만들어 중복 관리하지 않는다. |
| [PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) · `b044f956f021b6e8877f16781bcfc466a6a120e9` | CC0-1.0 | [rules/anti-overengineering.mdc](https://github.com/PatrickJS/awesome-cursorrules/blob/b044f956f021b6e8877f16781bcfc466a6a120e9/rules/anti-overengineering.mdc) · 규칙 콘텐츠의 선택적 적용에 참고. 모든 규칙을 전역에 합치거나 Cursor 전용 globs를 강제하지 않는다. |
| [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) · `052ad1cbd5aeb1ec4a1def22012d1293c6225625` | 루트 LICENSE 확인 불가 | [.claude/hooks/pre_tool_use.py](https://github.com/disler/claude-code-hooks-mastery/blob/052ad1cbd5aeb1ec4a1def22012d1293c6225625/.claude/hooks/pre_tool_use.py) · 실행 전·후·압축 전 구분만 참고. 예제의 오류 시 허용 처리와 동시성 없는 로그 전체 재작성은 이식하지 않는다. |
| [kenryu42/cc-safety-net](https://github.com/kenryu42/cc-safety-net) · `dd8370f2894bc85f1cba9ef422b7a58a47b977a0` | MIT | [src/core/policy/merge.ts](https://github.com/kenryu42/cc-safety-net/blob/dd8370f2894bc85f1cba9ef422b7a58a47b977a0/src/core/policy/merge.ts) · 상위 보호를 약화하지 않는 선택적 정책과 분석 한도 참고. tightenOnly 기본값이 false임을 구분하며 새 셸 분석기는 도입하지 않는다. |
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) · `ed74d115b7fb7026a22a4f816a8e3250f425e3b4` | MIT | [categories/09-meta-orchestration/context-manager.md](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/ed74d115b7fb7026a22a4f816a8e3250f425e3b4/categories/09-meta-orchestration/context-manager.md) · 역할의 파일 소유권·입출력 설명 참고. 모델·도구 선언을 실제 Codex 권한이나 실행 기능으로 복제하지 않는다. |
| [wshobson/agents](https://github.com/wshobson/agents) · `4bde3168b43c0655c4d00ea2726e631719908a6d` | MIT | [docs/plugin-eval.md](https://github.com/wshobson/agents/blob/4bde3168b43c0655c4d00ea2726e631719908a6d/docs/plugin-eval.md) · 정적 검사와 과제 수행 검증을 분리하는 계약 채택. 실험적 LLM judge를 품질 인증으로 사용하지 않는다. |
| [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) · `2996ff4311049aee39668b23b06913c4bf24087a` | MIT; 수집 요소 별도 확인 | [cli-tool/src/validation/validators/ProvenanceValidator.js](https://github.com/davila7/claude-code-templates/blob/2996ff4311049aee39668b23b06913c4bf24087a/cli-tool/src/validation/validators/ProvenanceValidator.js) · 구조 검사와 출처 검사를 분리하는 방식 참고. 자동 설치와 오래된 모델 allowlist를 들여오지 않는다. |
| [anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts) · `8ef47d719eba5379ff8f38133f5defcc499e856f` | MIT | [managed-agents/daily-brief/agents/daily-brief/agent.md](https://github.com/anthropics/claude-quickstarts/blob/8ef47d719eba5379ff8f38133f5defcc499e856f/managed-agents/daily-brief/agents/daily-brief/agent.md) · 읽지 못함과 빈 자료를 구분하고 확인된 전달 뒤 진행 상태를 갱신하는 비코딩 계약을 후속 설계에 채택. prompt 예제를 실행 보장으로 표현하지 않는다. |
| [snarktank/ralph](https://github.com/snarktank/ralph) · `6c53cb0b831ebe8739c6a003e22af14902d8b0b5` | MIT | [ralph.sh](https://github.com/snarktank/ralph/blob/6c53cb0b831ebe8739c6a003e22af14902d8b0b5/ralph.sh) · 작은 작업과 외부 진행 기록 원칙 유지. 권한 우회 플래그·무조건 반복·완료 문자열 grep을 거절한다. |
| [openai/symphony](https://github.com/openai/symphony) · `be10a1b79df723d6d7612b5651c8522704dafb2e` | Apache-2.0 | [elixir/lib/symphony_elixir/workflow_store.ex](https://github.com/openai/symphony/blob/be10a1b79df723d6d7612b5651c8522704dafb2e/elixir/lib/symphony_elixir/workflow_store.ex) · 검증 후 설정을 교체하는 snapshot 원칙 참고. 오래된 승인 유지에 적용하지 않으며 분산 orchestrator 도입은 보류한다. |
| [harbor-framework/harbor](https://github.com/harbor-framework/harbor) · `26f95e0ebd8c77011bbf4656f5c98af66ce55848` | Apache-2.0 | [src/harbor/models/trial/result.py](https://github.com/harbor-framework/harbor/blob/26f95e0ebd8c77011bbf4656f5c98af66ce55848/src/harbor/models/trial/result.py) · 작업 checksum·검사기·실패·nullable 사용량을 실행 비교에 반영. Python 프레임워크와 컨테이너를 추가하지 않는다. |
| [harbor-framework/terminal-bench](https://github.com/harbor-framework/terminal-bench) · `fbf8a8c02fd1ef7151b5bbb460baed51c15803dd` | Apache-2.0 | [tasks/heat-pump-warranty/tests/test_scoring.py](https://github.com/harbor-framework/terminal-bench/blob/fbf8a8c02fd1ef7151b5bbb460baed51c15803dd/tasks/heat-pump-warranty/tests/test_scoring.py) · 비코딩 과제의 출처 우선순위·정확한 근거 집합 검사 참고. 공개 과제·정답과 Docker stack은 복사하지 않는다. |
| [QoderAI/better-harness](https://github.com/QoderAI/better-harness) · `b605532fcf1014bcb48d3e6940a5bc64e80cddd5` | MIT | [packages/harness/src/experiment/axis.ts](https://github.com/QoderAI/better-harness/blob/b605532fcf1014bcb48d3e6940a5bc64e80cddd5/packages/harness/src/experiment/axis.ts) · 입력·모델·환경의 비교 자격 판정 채택. aggregate.ts의 costUsd 누락→0 동작은 복제하지 않고 null을 유지한다. |
| [walkinglabs/learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering) · `a9342ff471f2c0e60be0c08b9f4a7c502df4e442` | MIT | [docs/en/lectures/lecture-13-loop-engineering/code/loop-state-template.md](https://github.com/walkinglabs/learn-harness-engineering/blob/a9342ff471f2c0e60be0c08b9f4a7c502df4e442/docs/en/lectures/lecture-13-loop-engineering/code/loop-state-template.md) · 성공·실패·부분 결과·수동 중단 분류 참고. QA 교육 예제의 mock 답과 고정 confidence는 구현 근거에서 제외한다. |
| [ai-boost/awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering) · `c4912ffa545d6f590440b4d5e326121e362bb485` | CC0-1.0 | [templates/HARNESS_CHECKLIST.md](https://github.com/ai-boost/awesome-harness-engineering/blob/c4912ffa545d6f590440b4d5e326121e362bb485/templates/HARNESS_CHECKLIST.md) · 평가 기준과 구성요소 제거 조건 참고. 링크 응답 확인을 대상 기능 검증으로 해석하지 않는다. |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) · `aacae21bffd6ef7f153658bc47aa0943a7822624` | CC BY-NC-ND 4.0 | [resources/resource_utils.py](https://github.com/hesreallyhim/awesome-claude-code/blob/aacae21bffd6ef7f153658bc47aa0943a7822624/resources/resource_utils.py) · 목록의 마지막 점검·stale 구분만 참고. 목록 설명·데이터·코드는 복제하지 않고 각 원본을 확인한다. |

Agent Skills의 공식 [명세](https://agentskills.io/specification)는 단계적 읽기의 참고 자료다. 이번 구현의 단일 행 메타데이터 제한은 Ariadne 자체 계약이다.
