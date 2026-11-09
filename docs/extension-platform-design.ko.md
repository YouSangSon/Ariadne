# Ariadne 모듈과 사용자 확장 설계

작성: YouSangSon의 요청을 바탕으로 Codex 작성 · 2026-11-09
상태: 목표 설계 작성·독립 검토 완료. 후속 [E0 첫 구현](extension-implementation-plan.ko.md)은 계약·참조 projector·검사 CLI와 Go 경계 검사를 제공한다. 사용자 확장 registry·sandbox·설치/실행 CLI는 아직 구현하지 않았다.
기준: `568f970`. [요구사항](../.harness/reqs/extension-platform-design.yaml). [Go+Rust 전환 설계](go-rust-runtime-design.ko.md)의 업무 소유권·TDD와 [실행 정책](execution-policy.md)을 계승한다.

## 1. 원하는 결과와 범위

사용자가 “우리 팀 방식으로 결과를 정리해 줘”, “이 자료원을 연결해 줘”라고 요청하면 Ariadne 코어를 수정하는 대신 공개 확장 지점에 기능을 추가하는 것이 목표다. 각 모듈은 책임과 내부 구현을 소유하고 다른 모듈은 작은 공개 계약으로 기능을 사용한다. 선택 설치는 이 구조의 결과이며 모듈화 자체의 정의는 아니다.

안정적인 코어는 권한·예산·실행 수명·검증의 공통 불변조건을 유지한다. Memory·Code·Ontology·Context·Evaluation 등은 자기 업무 규칙과 데이터를 계속 소유한다. 사용자 확장은 허용된 입력과 기능만 사용하며 원본 데이터나 완료 판정의 소유자가 되지 않는다. 내장 기능도 의미가 같은 확장 지점에서는 같은 계약을 사용해 계약을 실제로 검증한다.

이번 산출물은 아키텍처와 계약·실패·이행·검증 설계, 관련 문서 연결과 로컬 커밋이다. 제품 코드·컨테이너·설정·credential·데이터를 변경하거나 원격 게시하지 않는다. 첫 구현 범위는 로컬 사용자가 명시적으로 실행하는 순수 보고서 projection(원본에서 파생한 표시 결과)이다. 원격 다중 사용자 서비스, 자동 이벤트/cron, 외부 쓰기·발송, 임의 native plugin, 동적 UI와 플러그인 마켓은 후속 범위다.

## 2. 근거와 현재 계약

Jeremy Morrell의 [Extensible Software in the age of LLMs](https://jeremymorrell.dev/blog/extensible-software-in-the-age-of-llms/)는 작은 안정적 코어, 사용자 작성 확장, 좁게 허용한 기능과 실행 격리를 함께 제안한다. 자원·관측·버전 관리도 확장 플랫폼의 책임으로 다룬다. 이 문서는 해당 방향을 Ariadne에 적용한 설계이며 글의 제품 성능이나 특정 공급자 추천을 Ariadne의 검증 결과로 사용하지 않는다.

| 현재 정본·경로 | 실제 상태와 이번 설계의 제약 |
| --- | --- |
| `core/domain/product.mjs`, `lib/module-selection.mjs` | 정적 명령 연결, 선택 설치/검증. 설치 모듈은 core/memory/code/ontology이며 동적 plugin 목록이 아님 |
| `docs/harness-synthesis-design.md` §4 | composition의 임의 문자열 plugin loading 금지. 이번 설계는 검증된 별도 확장 진입점만 후속으로 추가하며 해당 금지를 전역 해제하지 않음 |
| `evaluation/comparison.mjs:compareRuns`, `evaluation/compare-cli.mjs` | 보고된 실행을 검증·비교해 출력. 첫 확장은 별도 표시 결과를 만들고 기존 JSON·수치·판정을 유지 |
| `modules/context/domain.mjs:renderPack` | relevant_notes에도 verification·legacy handoff가 포함될 수 있음. 선택 노트라는 이유로 안전하게 삭제·변환할 수 있다고 가정하지 않음 |
| Go+Rust 설계 §5–7 | 신뢰된 native 계산, 요청/응답 한 번의 compute/1. 비신뢰 code sandbox나 양방향 hostcall 프로토콜이 아님 |
| 실행 정책·하네스 합성 설계 | 설치/로그인/외부 이벤트가 실행 승인·예산·새 권한을 만들지 않음. Task 제어 runtime은 아직 미구현 |

## 3. 설계 결정과 대안

| ID | 선택·근거 | 적용 한계 |
| --- | --- | --- |
| EX-D01 | 업무별 모듈 + 안정적인 공개 확장 계약. 사용자의 DDD·클린 아키텍처·모듈화·확장성 요구 | 언어별 분리나 설치 옵션만으로 완료로 보지 않음 |
| EX-D02 | 내장 모듈·신뢰 native 계산·비신뢰 확장을 구분 | hash나 저자 서명만으로 사용자 code를 내장 신뢰로 승격하지 않음 |
| EX-D03 | 첫 사용자 확장은 hostcall 없는 평가 보고서 projection | Context 필수 자료·평가 판정·실행 승인에 개입하지 않음 |
| EX-D04 | 비신뢰 실행 후보는 Rust Wasmtime worker + 자원 제한된 Podman | runtime/OS 적합성 확인 전 실행 불가. bare native fallback 없음 |
| EX-D05 | 권한은 manifest 요청이 아니라 호스트의 현재 허용 범위로 결정 | 설치와 실행 구분, 확장 간 권한 합산·상속 없음 |
| EX-D06 | immutable artifact·명시적 활성 revision·실행 고정 | hot reload·자동 dependency 다운로드·자동 update 없음 |
| EX-D07 | E2 이후 capability는 호출마다 owner에서 재인가 | DB·원시 key·임의 fetch/파일/셸 제공 안 함 |
| EX-D08 | 기존 완료·budget 권위를 유지하고 파생 출력을 비신뢰로 표시 | 모델 생성 code와 sandbox 출력도 사실·검증 receipt가 아님 |
| EX-D09 | TDD와 내장/사용자 구현의 같은 적합성 사례로 확장 계약 검증 | 같은 권한이나 같은 실행 backend를 강제하는 것은 아님 |

EX-D01은 기존 요청의 구체화이고 이번 “설계해줘”는 사용자 확장 설계 범위의 승인이다. 나머지 runtime·형식·초기 한도는 설계 제안이며 사용자에게서 개별 승인된 보안 정책으로 기록하지 않는다. 기존 정책과 충돌하는 외부 효과·자동 실행은 이 설계로 활성화하지 않는다.

| 구조 대안 | 얻는 점 | 이번 판단 |
| --- | --- | --- |
| 모든 plugin을 Go 프로세스에 로드 | 낮은 호출 비용 | 비신뢰 code의 장애·권한 격리가 없어 내장 모듈에만 사용 |
| WASM만 별도 native worker에서 실행 | 명시 import와 빠른 실행 후보 | compile·runtime 전체 RSS/CPU 제한이 없어 첫 비신뢰 지원으로 단독 채택하지 않음 |
| WASM + 호출별 Podman worker | WASM 계약과 OS 제한을 함께 시험 가능 | 첫 로컬 검증 대상으로 채택. 시작 시간·메모리 비용은 수용하되 측정 필요 |
| hosted isolate/microVM 서비스 | 대규모 운영·독립 격리 가능성 | 공급자·네트워크·과금·운영 비용 때문에 보류. 지원 OS와 부하·위협 모델이 요구할 때 별도 검토 |

호출별 컨테이너는 저비용 대규모 서비스의 결론이 아니다. 첫 지원 범위를 좁혀 OS 한도와 정리를 검증하는 선택이다. core-only 사용자는 확장 runtime·Podman 이미지·WASM compiler를 설치할 필요가 없다.

## 4. 아키텍처와 소유권

Go의 Extensions context는 artifact identity·등록 상태·extension 계약 호환·invocation 수명을 소유한다. 업무 모듈은 확장 입력 선택과 결과 적용을 소유한다. 공통 Task/Execution 권위는 기존 설계의 owner에 그대로 둔다. Extensions가 두 번째 dispatcher·승인 시스템·이벤트 원장이 되지 않는다.

| 경계 | 소유하는 것 | 외부에 주는 계약 |
| --- | --- | --- |
| Evaluation application | 비교 의미·수치·원본 보고서 | 선택한 보고서의 bounded projection input |
| Extensions domain/application | 설치 revision·활성 상태·compatibility·invocation | `Inspect`, `Install`, `Activate`, `Invoke`, `Disable`, `Remove` 의미 계약 |
| Host capability adapter | 현재 주체·scope·수명·호출 예산 검사, owner 호출 | E1에는 없음. E2에 승인된 특정 자료 조회 handle |
| Rust extension worker | raw WASM 검사·compile·instantiate·제한 실행 | 별도 `ariadne.extension-worker/1` transport |
| 실행 격리 adapter | Podman admission·컨테이너 수명·자원 한도·종료/정리 | 불가하면 `UNSUPPORTED_RUNTIME` |
| Native compute adapter | 기존 순수 수치 계산 | compute/1 유지. 사용자 artifact를 받지 않음 |

domain은 SQL·Podman·Wasmtime·HTTP를 import하지 않는다. application이 소비 포트를 정의하고 adapter가 구현한다. composition만 구체 구현을 연결한다. 다른 모듈의 내부 model·repository·DB transaction을 SDK로 export하지 않는다. Extensions registry 저장은 자기 owner의 adapter가 맡는다.

새 first-party report projector도 동일 projection input/output schema·등록 descriptor·적합성 시험을 사용한다. 신뢰된 내장 구현은 정적 Go 함수로 조립하며 WASM/Podman을 강제하지 않는다. 의존성 검사로 의미 계약 우회를 잡되 정적 모듈이 악성 code에 대한 security boundary라고 주장하지 않는다. Memory DB adapter 같은 내부 인프라까지 사용자 plugin API로 공개하지 않는다.

모듈 API는 업무 기능을 깊게 감춘다. 예를 들어 `ReadApprovedReport(ref)`는 권한과 revision 확인을 owner 안에서 마치며 호출자에게 조회 SQL·lock·hydration 순서를 조립하게 하지 않는다. 범용 `get/set/send(any)`와 거대한 공통 SDK는 만들지 않는다.

## 5. 사용자 흐름과 첫 확장 계약

**예정 사용 예시**다. 현재 실행 가능한 CLI가 아니다.

```sh
Ariadne extensions inspect --package ./team-report
Ariadne extensions install --package ./team-report
Ariadne extensions activate team-report --digest <reviewed-package-digest>
Ariadne extensions run team-report --input ./comparison.json
Ariadne extensions disable team-report
Ariadne extensions remove team-report
```

작성자는 공개 schema·WIT(WASM의 입출력 interface 정의)·예제·테스트만 읽고 확장을 만들 수 있어야 한다. LLM에는 선택한 계약과 허용 예제만 전달한다. code 생성은 후보 작성일 뿐이며 자동 설치·활성화·실행이 아니다. author build script나 npm/Cargo hook는 사용자 확장 실행의 격리 보장을 받지 않으므로 제품 installer가 실행하지 않는다. 초기 installer는 명시 경로의 완성된 raw WASM 패키지만 받는다.

첫 `report-projector/1` 입력은 host가 검증·선택·scrub한 비교 보고서와 불투명 source ID다. input schema version과 원본 digest를 포함하며 비밀·절대 경로·다른 조직 자료를 자동 수집하지 않는다. 원본 파일이 있다는 사실은 보고 내용이 실제로 검증됐다는 증거가 아니다. 기존 comparator의 descriptive-only·unknown 의미를 보존한다.

WIT world `ariadne:extensions/report-projector@1.0.0`은 `project(input: list<u8>) -> result<list<u8>, string>`만 export하며 import는 없다. JSON bytes의 request/result schema를 별도 고정한다. WASI·clock·random·filesystem·network·stdio·environment·모델·다른 extension 호출을 연결하지 않는다. 불필요한 import 또는 다른 world는 reject한다. 다른 언어로 작성해도 이 world로 compile·적합성 시험을 통과해야 지원한다.

결과는 `sections` 배열과 선택적 표의 column/row 문자열, 입력에서 받은 source ID만 포함한다. 원본 비교 수치·pass/fail·승인·receipt·artifact path를 변경하는 field는 없다. host는 ID가 실제 입력에 있었는지 확인한다. 확장이 본문에서 “성공”이라고 써도 권위가 생기지 않는다. canonical 비교 JSON은 그대로 두고 extension ID/digest·input digest·파생/비신뢰 표시를 host가 별도 부착한다.

첫 출력은 host가 안전한 텍스트로 렌더링해 명시 실행의 stdout으로 반환한다. ANSI/control·HTML은 실행하지 않고 Markdown 특수문자를 destination 규칙으로 escape한다. 입력 값 자체의 prompt injection을 안전한 명령으로 해석하지 않는다. 외부 자동 업로드·UI 렌더·Memory 저장·완료 판정에는 연결하지 않는다. 파일 저장 기능은 기존 guarded writer의 exclusive workspace·expected hash 계약을 사용하는 별도 후속 단계이며 확장이 경로를 선택하지 않는다.

첫 기능은 수치의 계산과 보안 결정을 host에 남기므로 자유로운 업무 자동화 전체를 제공하지 않는다. 실제 사용 예는 팀별 평가 보고서의 항목 순서·설명·표 형태를 추가하는 것이다.

## 6. 패키지·설치·버전과 registry

초기 패키지는 `manifest.json`, `extension.wasm`, 선택적 source/license 파일의 명시 목록이다. archive·symlink·실행 파일·install hook·원격 dependency는 받지 않는다. 초기 크기 한도는 manifest 32 KiB, raw WASM 8 MiB, 패키지 전체 16 MiB다. 읽기 중 크기·파일 종류·UTF-8·중복 JSON key·unknown field를 검사한다. source/license는 참고 자료이며 자동 실행하지 않는다.

manifest는 `schemaVersion`, namespace가 있는 `extensionId`, `version`, `world`, artifact SHA-256, SDK 계약 major, 표시 description, `requestedCapabilities`, license 식별을 둔다. E1 capabilities는 빈 배열만 허용한다. version 문자열은 identity가 아니며 실행은 canonical manifest와 파일 목록·bytes에서 계산한 package digest로 고정한다. 서명이나 hash는 code의 안전성 증명이 아니다. 출처와 hash가 바뀌면 별도 revision으로 설치·검토한다.

Go Extensions owner가 `.ariadne/private/extensions/registry.sqlite`와 private content-addressed artifact 디렉터리를 소유하는 목표다. SQLite의 신규 schema·driver와 backup은 E0에서 정하고 기존 Code/Memory DB에는 테이블을 추가하지 않는다. workspace identity와 로컬 사용자에 묶으며 다른 checkout의 설치/권한을 자동 공유하지 않는다. registry가 손상되거나 설치 root를 신뢰할 수 없으면 실행을 거절한다.

설치 상태는 `staged → installed-inactive → active → disabled → removed`다. 파일을 private staging으로 복사하며 digest를 확인하고 immutable 디렉터리로 원자 게시한 다음 registry transaction에 기록한다. 파일/DB 사이에는 원자성이 없으므로 crash 시 미등록 디렉터리는 실행하지 않고 reconciliation 대상으로 둔다. active mapping은 `(workspace, extensionId) -> exact digest, registry revision`이며 compare-and-swap으로 변경한다. 이전 digest를 삭제하지 않고 명시 rollback 대상으로 남길 수 있다.

설치는 실행을 하지 않는다. activate는 지정 revision의 사용 가능 상태만 바꾸며 data 접근이나 자동 실행을 승인하지 않는다. update는 새 비활성 revision 설치 후 검토·명시 활성화다. 권한이 줄어든 구버전으로 rollback해도 과거 grant를 되살리지 않는다. 계약 major/world 불일치는 시작 전에 거절하고, 추가 field도 schema가 허용하기 전 조용히 무시하지 않는다.

한 invocation은 시작 시 고정된 digest·registry revision·runtime profile을 사용한다. activate는 진행 중 버전을 교체하지 않고 이후 요청에 적용한다. disable은 새 admission을 차단하고 기존 invocation 취소·권한 무효화를 요청한다. 실제 종료와 late output 거절을 확인해야 완료다. remove는 비활성·종료·artifact 참조 0 확인 뒤 소유 파일만 지운다. 미확정 실행이 있으면 삭제를 보류한다. 사용자 source·보고서·기억·다른 revision이나 다른 프로젝트 자료는 지우지 않는다.

설치 source 경로는 신뢰 경계에서 검사한 뒤 private 복사본을 사용한다. 실행 시 원래 project package 경로를 재개방하지 않는다. registry·artifact 디렉터리의 OS 권한을 소유자가 통제한다는 전제가 있으며 같은 OS 계정의 악성 프로세스까지 설치 무결성을 보장하지 않는다. 이 전제를 원격 다중 tenant 지원으로 확대하지 않는다.

## 7. sandbox·자원·프로세스 수명

E1의 qualification 후보는 별도 Rust `ariadne-extension-worker`가 Wasmtime을 embed하고 **호출별 rootless Podman 컨테이너** 안에서 raw WASM 검증부터 수행하는 방식이다. 사용자 native code·동적 라이브러리·Go plugin을 로드하지 않는다. Go host에 Wasmtime을 직접 링크하지 않으며 신뢰 compute 바이너리와 사용자 worker를 별도 패키지·프로토콜·admission으로 분리한다.

호스트 runtime 이미지는 운영자가 준비한 digest로 pin하고 `--pull=never`에 해당하는 동작을 사용한다. extension 요청이 이미지를 지정하거나 자동 pull·로그인·machine 생성·환경 전환을 유발하지 않는다. network none, read-only root, non-root user, cap drop all, no-new-privileges, 제한된 seccomp, host mount·Podman socket 없음, 작은 tmpfs와 PID 제한을 요구한다. image의 ENV/entrypoint도 검토하고 host HOME·환경·credentials를 상속하지 않는다.

E1 backend는 E0에서 검증한 로컬 rootless server 또는 같은 기기의 Podman VM endpoint로 고정한다. 임의 remote server는 입력 반출 경로이므로 지원하지 않는다. CLI의 ambient `CONTAINER_HOST`/connection/config override로 endpoint를 선택하지 않으며 명시 연결과 현재 server identity·runtime profile을 admission마다 대조한다. 연결 identity가 달라지면 재qualification 전 실행하지 않는다. host가 신뢰하는 worker만 먼저 시작하고, guest bytes·보고서를 보내기 전에 container inspect로 image·rootless/privilege·mount·network·자원·log 설정이 qualified profile과 일치하는지 확인한다.

container의 log driver는 `none`으로 고정해 journald/k8s-file 등의 별도 원시 stdout/stderr 영속을 막는다. attach pipe에서만 protocol을 받고 host가 bounded·정제한 receipt를 남긴다. log-driver=none에서 attach가 동작하고 payload 원문이 container/daemon 로그에 남지 않는지 qualification한다. 이 동작을 확인하지 못하면 환경을 지원하지 않는다.

| 초기 qualification profile | 제안 한도·보장 범위 |
| --- | --- |
| OS 자원 | container memory 256 MiB, swap 추가 사용 금지, CPU quota 1 core, PIDs 32, tmpfs 16 MiB. 실제 적용을 inspect와 위반 시험으로 확인 |
| WASM store | linear memory 총 64 MiB, table 합계 16,384 elements, memories 16개·tables 16개·instances 64개, stack 1 MiB. per-memory 제한만 걸어 합계 제한으로 보고하지 않음 |
| 실행 | compile 포함 전체 wall 30초와 부모 남은 deadline 중 작은 값. Wasm fuel 10,000,000 및 epoch interruption. 시간·CPU 초와 fuel은 같은 단위가 아님 |
| 입력/결과 | input JSON 1 MiB, output JSON 256 KiB, section 32개, 표 전체 cell 1,024개, 개별 문자열 8 KiB |
| 동시성 | supervisor당 untrusted invocation 1개·대기 0개. Task 연결 시 기존 전체 2개 슬롯/동일 작업 예산 안에 추가 포함 |
| 로그 | host 보관 stderr 최대 64 KiB, 이후 drain+discard. raw guest console import는 없음 |

숫자는 실측 SLO가 아니라 과부하를 막기 위한 시험 초기값이다. 유효 패키지가 한도 안에서 compile되지 않으면 실패로 보고 profile을 자동 확대하지 않는다. Go의 입력/출력 buffer도 사전 상한과 copy 수를 제한한다. Wasmtime fuel은 hostcall이나 compiler CPU를 모두 계산하지 않고 linear memory는 전체 RSS가 아니다. 따라서 OS 한도와 wall deadline을 함께 검증한다. macOS/Windows Podman VM의 전체 자원은 위 container limit와 별개이며 기존 VM 설정을 바꾸지 않는다.

E0에서 고정한 Wasmtime feature allowlist를 적용하고 첫 profile에서는 threads·shared memory·memory64를 끈다. Component의 내부 instance·memory까지 합계로 제한하는 ResourceLimiter와 preflight 검증을 사용한다. 해당 합계 제한을 구현하지 못하면 per-memory 설정으로 대체하지 않고 qualification 실패로 남긴다. cgroup 밖의 호스트 registry/transport buffer도 입력 크기·동시성으로 별도 제한한다.

rootless cgroup·CPU/memory/swap 제한이 지원되지 않거나 적용을 확인할 수 없는 환경은 `UNSUPPORTED_RUNTIME`으로 닫는다. Docker Desktop이나 bare worker로 자동 전환하지 않는다. 컨테이너·WASM은 다층 제한이며 kernel/engine 취약점이나 모든 side channel을 제거한다는 보장이 아니다. 최초 지원은 단일 로컬 운영자이고 적대적 인터넷 다중 tenant 서비스는 별도 위협 모델·격리 검증 전까지 지원하지 않는다.

입력/worker protocol은 `ariadne.extension-worker/1`이다. E1은 4byte big-endian 길이 + UTF-8 JSON request/response 한 번이다. envelope에 invocation ID·package digest·input digest·world·profile revision을 고정한다. raw WASM bytes는 host가 읽고 크기·digest 검증한 뒤 별도 길이 frame으로 전달한다. guest가 host 파일 path를 지정하지 않는다. manifest가 아니라 실제 component import/export·features를 검사하고 dynamic code/component loading은 금지한다.

추가 frame·중복 key·unknown field·초과 길이·잘못된 상관관계는 거절한다. request/response의 byte schema·canonical digest fixture를 고정한다. 기존 compute/1과 이름만 바꿔 혼용하지 않는다. E1은 hostcall message를 받으면 protocol 오류다. E2의 양방향 capability 호출은 worker/2로 별도 정의한다.

정상 순서는 admission/예산 예약 → container ID 저장 → raw WASM 검사/compile → 실행 → response frame 검증 → host stdin close → worker tail EOF/join → stdout EOF와 exit/컨테이너 종료 확인 → 결과 전달 → 소유 container 정리다. 입력 두 frame은 길이로 읽고 EOF를 기다려 실행하지 않는다. worker는 별도 tail-reader로 추가 byte/부모 EOF를 감시한다. response flush 전 EOF는 취소, flush 후 EOF는 정리로 처리한다. 추가 byte를 받았으면 response 이후라도 두 번째 frame 없이 nonzero 종료한다.

Go가 `podman run` 자식만 죽여도 컨테이너가 멈췄다고 간주하지 않는다. 생성 전에 invocation별 고유 이름·무작위 소유 nonce·label·Podman endpoint identity와 launch intent를 registry transaction에 남기고 reservation을 확보한다. CID 획득 뒤 같은 기록에 연결한다. CID 기록 전 crash는 미리 저장한 이름과 모든 label/nonce가 맞는 대상을 대조하며 이름만 같다는 이유로 종료하지 않는다. 중복 supervisor는 registry lease/CAS로 cleanup 소유권을 얻고 동일 대상에 대해서만 작업한다. endpoint가 바뀌거나 자원 소유권을 확인하지 못하면 unknown으로 보존한다.

CID와 고유 label을 이용해 정확한 컨테이너에 stop/kill·wait/inspect를 수행하고 I/O goroutine과 Podman client도 회수한다. worker watchdog·epoch/fuel은 보조 중단 수단이다. 종료를 확인하지 못하면 reservation을 유지하고 runner를 격리한다. 같은 실행을 다시 시작하지 않는다. host crash 후 해당 supervisor의 기록을 대조하여 자기 container만 종료/정리하고 자동 재실행하지 않는다. `--rm`에만 정리를 의존하지 않는다. lease timeout만으로 구 owner가 죽었다고 판단하지 않고 registry revision과 실제 resource 상태를 대조한다.

host와 독립적인 conmon/container runtime 최대 수명도 30초로 설정하고 restart policy는 off로 고정한다. Podman의 `--timeout` 등 해당 profile의 실제 동작으로 input 대기·compile·실행 중 host SIGKILL 뒤에도 컨테이너가 상한 안에 종료되는지 확인한다. host의 더 짧은 deadline은 host adapter가 중단하며, host 사망 시 그 짧은 deadline의 즉시 강제까지 보장하지 않는다. 생성 명령 자체의 완료가 unknown이면 persisted intent를 보존하고 새 admission을 차단한다. 부모 독립 수명을 강제할 수 없는 backend는 unsupported다. 종료 상한과 사후 container metadata 정리는 다른 의무이며 나중의 reconciliation이 정리 완료를 확인한다.

OOM·compile 실패·trap·fuel 소진·deadline·출력 초과·protocol 오류는 구조화된 실패다. guest 문자열·trace·입력 내용을 원시 로그로 노출하지 않는다. E1은 부수효과가 없어 재계산 가능하지만 자동 재시도는 없다. 종료/정리 실패와 성공을 섞지 않으며 결과는 정리 상태와 별도로 표시하되 미정리 실행은 완료 봉인의 근거가 될 수 없다.

## 8. capability 확장과 권한 경계

E1에는 hostcall이 없다. E2의 첫 후보는 사용자가 고른 자료 하나의 snapshot 조회다. `ReadApprovedResource(handle, expectedRevision)`처럼 owner가 자료를 정한 불투명 handle을 준다. path·SQL·URL·DB 연결·raw key·임의 fetch를 주지 않는다. handle은 확장 digest·invocation·주체·org/scope·자료 revision·유효기간·읽기 byte/횟수 한도에 host가 묶는다. 추측 가능한 문자열을 보안 근거로 사용하지 않으며 매번 host registry에서 일치를 검사한다.

E2는 기존 authorization의 현재 허용 범위와 capability 요청의 교집합만 노출한다. manifest가 요구한 기능은 허가가 아니다. owner는 매 read마다 현재 주체·조직·scope·권한 취소·revision을 다시 확인한다. stale/denied/unavailable을 empty로 바꾸지 않는다. task/runtime 권위와 budget 예약을 연결하지 못한 상태에서는 자동 실행이나 tenant 자료 조회를 켜지 않는다.

worker/2는 단일 invocation 안에서 hostcall request ID·sequence·capability handle을 사용하고 한 번에 하나만 진행한다. host가 정한 횟수·byte·전체 deadline을 적용한다. callback은 worker 외부 host adapter가 owner를 호출하고 bounded result를 반환한다. callback 시간도 invocation 시간에 포함하며 cancel 뒤 새 callback과 late 결과를 차단한다. 서브 extension 호출은 허용하지 않는다. 구체 frame schema와 수치는 E2 구현 전 계약 문서/fixture로 고정하는 선행조건이며 worker/1에 호환 field로 몰래 추가하지 않는다.

권한이 좁아도 자료를 읽은 뒤 다른 capability로 외부에 전송하면 유출이 가능하다. 따라서 읽기와 outbound capability의 조합·출력 목적지까지 host가 반출 정책으로 검사해야 한다. E1/E2는 외부 전송 capability를 제공하지 않는다. 출력·log·예외·모델 입력도 같은 반출 경계다. 증거·허가·필수 문맥을 extension이 만들거나 승인하도록 하지 않는다.

쓰기·발송·모델 호출·schedule·event hook은 E3 이후다. 이 설계는 그 행동의 새 권한/보존/요금 정책을 확정하지 않는다. owner의 멱등성 key·동일 key 파라미터 대조·중간 상태 조회·결과 불명·승인 취소·transaction/outbox와 retry 소유자를 정하기 전 지원하지 않는다. 이 미정 범위는 E0/E1 설계와 구현을 막지 않는다.

## 9. SDK·수명·버전·테스트 계약

공개 SDK는 projection schema/WIT, descriptor 검증, fixture runner와 소형 예제만으로 시작한다. 작성 언어·파일 수를 공개 모듈 계약으로 삼지 않는다. adapter 작성자는 내부 DB 구조 대신 자신의 extension point 문서만 읽고 구현할 수 있어야 한다. 내장과 사용자 projection에 같은 정상/거절 fixture를 실행하되 권한 검사·runtime 격리 시험은 별도다.

처음에는 extension 간 dependency·service discovery·우선순위 chain이 없다. 호출자가 extension digest 하나를 명시하며 순서를 이름 순이나 설치 시각으로 추정하지 않는다. 후속 hook도 required verifier를 대체하거나 권한 판정을 intercept하지 못한다. 조합이 필요해지면 입력/출력 type·순서·예산·실패 의미를 먼저 정한다.

로그/receipt는 invocation ID, package/runtime/profile digest, input/output digest, 관측 시간·상태·자원 측정·정리 상태를 포함한다. raw 자료/guest source/credentials는 기본 기록하지 않는다. digest는 사실성·검증 receipt의 서명이 아니다. 출력 reuse cache는 E1에서 두지 않고 registry와 결과를 혼동하지 않는다. 추후 캐시는 권한·org·scope·자료 revision·extension/runtime/config에 묶고 권한 재확인을 생략하지 않는다.

버전 변화는 WIT/world major와 schema 호환을 각각 검사한다. runtime patch/security update는 재검증한 image digest로 배포하고 기존 invocation은 pinned runtime으로 종료한다. 알려진 취약 runtime은 새 admission을 거절하고 운영자가 지정한 digest로만 교체한다. 자동 remote 업데이트나 과거 위험 profile로의 자동 rollback은 없다.

## 10. 구현 순서와 예정 파일

아래는 전체 이행 단계다. 현재 E0 계약 기반 일부만 구현했으며 실행 격리·E1 이후는 후속 구현이다. Go+Rust G0/G1 기반과 병행 가능한 계약 작업만 먼저 하고, E1을 위해 paused Task dispatcher 전체를 선행 구현하지 않는다.

| 단계 | 산출물 | 통과·중단 기준 |
| --- | --- | --- |
| E0 | projection schema/WIT·내장 projector·fixture·runtime qualification | 실제 host 기능과 의미 일치, Podman/Wasmtime native target·한도·image 확보. runtime 부적합이면 E1 실행 보류 |
| E1 | 로컬 패키지 inspect/install/activate/run/disable/remove, pure WASM | 같은 계약의 내장/사용자 결과, installer 무실행, 격리·종료·crash·정리·크기 제한. explicit invoke만 지원 |
| E2 | 좁은 read capability와 worker/2 | Task 권한/예산 및 owner API 연결, 권한 취소·교차 org·late callback·반출 검사. 상세 v2 schema 확정 전 활성화 금지 |
| E3 | 필요한 도구·workflow·event/쓰기 확장 | 개별 정책 결정과 외부 효과·멱등성·복구 설계 및 지원 조합 검증 |

| 예정 경로 | 역할 |
| --- | --- |
| `contracts/extensions/v1/manifest.schema.json`, `projection-{input,output}.schema.json`, `report-projector.wit`, `fixtures/` | 하나의 공개 계약 정본과 부정 fixture |
| `runtime/go/internal/extensions/{domain,application,adapters}/` | artifact·registry·실행 use case·SQLite/Podman adapter. 단계별 상세 파일은 구현 전 소유 map에 등록 |
| `runtime/go/internal/evaluation/application/projection.go`, 내장 projection adapter | 원본 비교/판정 보호, 표준 계약으로 입력 선택·출력 렌더 |
| `runtime/rust/crates/ariadne-extension-worker/` | compute와 별도 binary, Wasmtime compile/store·fuel/epoch·wire·EOF 수명 |
| `sdk/extensions/`, `examples/extensions/team-report/` | WIT/schema 기반 최소 helper·author fixture·raw WASM 예제 빌드 절차 |
| `runtime/extensions/Containerfile`, image manifest | pin된 host runtime·native dependency·rootless hardening. extension source를 image build에 실행하지 않음 |
| `tools/build.go`, `architecture-map.json`, package maps, CI | optional extension-runtime 패키징·소스 전수 소유·위반 import·Podman qualification gate |
| README 네 언어·운영 문서·`.gitignore` | 실제 E1 제공 시 설치 요구/미지원 환경/registry·cache·제거 동작 반영 |

기존 공개 module 이름 네 개와 Node CLI는 이번 설계에서 바꾸지 않는다. extension-runtime은 별도 opt-in 배포 기능이며 기본 core-only 빌드가 Wasmtime·Podman image를 끌어오지 않는다. 사용자 패키지 설치는 product module 설치와 다른 수명이다. WIT 정본에서 binding/schema 일치 검사를 만들고 목록을 여러 군데 손으로 복제하지 않는다.

TDD는 업무 결과의 실패 테스트 → 최소 구현 → 경계 정리 → 관련 통합 검사 순서다. domain 상태 전이/CAS는 단위, installer·registry crash는 실제 파일/SQLite, protocol·trap·EOF는 Rust/Go 통합, 격리/CPU/RSS/잔여 container는 Podman으로 검증한다. 각 source 상태에서 유효한 통과 근거는 재사용한다. native unit 결과로 OS 한도나 실제 정리를 입증하지 않는다.

## 11. 인수 시나리오

아래는 설계에서 도출한 기대 결과이며 실행한 테스트가 아니다.

| ID / 결정 | 조건·행동 | 기대 결과·검증 |
| --- | --- | --- |
| EX-S01 / D01,D09 | 같은 projection을 내장·사용자 구현으로 호출 | 공개 schema·source 참조·수치 원본 보존, 동일 contract fixture 통과 |
| EX-S02 / D02,D06 | install hook/native/symlink/oversize·hash 불일치 package | code 실행·네트워크·기존 active 변경 없이 거절. 파일 통합 |
| EX-S03 / D03,D08 | 확장 출력에 forged receipt/승인·원본 덮어쓰기·HTML/ANSI | schema 거절 또는 inert 표시, 원본/완료 판정 불변. renderer/API 계약 |
| EX-S04 / D04 | guest WASI/env/network/file import, 동적 component/native 시도 | 실제 import 검사에서 거절, 자원이나 key 노출 없음. sandbox 통합 |
| EX-S05 / D04 | 무한 loop·memory/table 증가·깊은 stack·compile 폭주·output flood | 해당 limit로 실패, 다른 작업/원본 보존, 회수 관측. Podman 검사 |
| EX-S06 / D04 | rootless/cgroup 제한 미지원·image 누락 | 실행 전 unsupported, 자동 pull/native/Docker fallback 없음 |
| EX-S07 / D04,D06 | input 대기·compile·실행 중 부모 SIGKILL, worker panic·Podman client만 종료 | 부모 독립 최대 수명·restart off 확인. intent/CID로 종료·정리, unknown slot 유지, 자동 재실행 없음 |
| EX-S08 / D06 | activate CAS 경합·설치 도중 crash·update 중 기존 실행 | 단일 active revision, orphan 실행 금지, 진행 invocation pinned 유지 |
| EX-S09 / D05,D06 | disable/remove와 run 경합 | 새 admission/late output 차단, 종료 전 파일 제거 금지, 사용자 source 보존 |
| EX-S10 / D07 | E2 handle 위조·다른 extension/invocation/org/scope·권한 취소 | 매 callback owner 거절, 존재·본문·개수 미노출, late callback 차단 |
| EX-S11 / D05,D07 | manifest 권한 확대·구버전 rollback | 권한 자동 확대·과거 grant 부활 없음, 미지원 조합 시작 거절 |
| EX-S12 / D03,D08 | projection input에 prompt injection·unknown 평가 비용 | code sandbox와 별개로 비신뢰 표시, 필수 문맥/gate 불변, 비용 unknown 유지 |
| EX-S13 / D01,D04 | core/ontology만 설치 | extension image·Podman·Wasmtime·registry 자동 시작/생성 없음 |
| EX-S14 / D04,D09 | 동일 입력 native·WASM+Podman cold/warm 비교 | compile·startup·CPU·전체 RSS·설치/image 용량·정리 시간 포함, 무료/저비용 주장 금지 |
| EX-S15 / D04,D05 | 동시 CLI·취소·권한 변경·정리 실패 | registry admission CAS와 현재 한도 유지, 실패 slot/참조 재사용 금지 |
| EX-S16 / D04,D08 | stderr/stdout에 민감한 보고서 원문 출력·ambient endpoint/config 변경 | raw container/daemon 로그 미기록·attach 수신 검증, endpoint/profile 불일치 시 guest bytes 전달 전 거절 |

## 12. 운영·정리·남은 결정

첫 registry의 invocation 기록은 admission과 정확한 자원 회수를 위한 것이며 공통 Task 원장을 복제하지 않는다. Task 연결 시 기존 runtime owner가 전체 슬롯/예산을 소유하고 Extensions가 예약 참조만 유지한다. 동시 여러 CLI는 동일 workspace registry transaction으로 admission을 직렬화한다. 초기 host/supervisor 상한과 전역/다른 workspace 상한은 구분하며 registry 하나로 OS 전체 격리를 주장하지 않는다.

실행 ID별 staging·tmpfs·container·compile cache·로그를 식별한다. 첫 E1은 untrusted native AOT artifact를 받거나 deserialize하지 않고 매번 raw WASM을 검증/compile한다. 향후 cache는 host가 생성한 것만 owner/runtime/target/config/digest별로 사용하며 검증과 권한을 대신하지 않는다. sandbox 이미지·공유 module cache는 매 호출 삭제 대상이 아니다. 이번 실행 소유 container·staging·임시 cache만 종료 확인과 증거 보존 후 지운다. private registry·사용자 artifact·원본 `.parallax/.akasha`는 재생성 가능한 cache로 취급하지 않는다. 전체 prune·Podman machine/context 삭제는 하지 않는다.

설치 상태·package revision·입력 전달·반출 권한·자원 사용을 사용자가 inspect할 수 있게 한다. 먼저 metadata만 노출하고 실제 code·자료는 명시 조회한다. 성공 로그만 남기지 않고 실패/거절/unknown/정리 실패를 표시한다. extension count를 성장 목표나 품질 근거로 사용하지 않는다.

E0에서 선택할 항목은 안정 Wasmtime/Cargo/Go/SQLite driver 버전과 OS별 Podman profile·image digest, WIT toolchain 적합성·compile 크기/메모리 한도다. 현재 웹 API 문서에는 dev 버전도 포함되므로 그것을 release pin으로 사용하지 않는다. E2의 상세 callback schema와 E3의 외부 효과 정책은 해당 단계 전까지 미확정이다. E0/E1은 정의된 순수 계약으로 독립 진행 가능하다.

완료조건은 기존 owner·정책 대조, 대안 비교, 수명/권한/자원 경계와 EX-D/EX-S 연결, 독립 보안·설계 검토, REQ/링크/diff 검증이다. SDK 작성·TDD 실행·sandbox 보장·지원 OS·성능은 구현 뒤 실제 시험 결과로 별도 보고한다.

독립 대안 검토로 Context 변환 대신 평가 표시 projection을 첫 사례로 선택했다. 독립 보안 리뷰의 Major 3건인 원시 컨테이너 로그·부모 사망 뒤 수명·ambient endpoint 선택 문제를 §7과 EX-S07/16에서 보완하고 재검토로 해소를 확인했다. 재검토 범위의 미해결 Blocker/Major는 없다. 초기 문서 검증은 관련 4개 문서의 상대 파일 링크 37개·fence, 실제 strict REQ parser의 AC 3개, EX-D 9개/EX-S 16개 연결과 최종 diff 확인이다. 이후 Go 계약 CLI 빌드·검사는 구현 계획의 근거로 추가됐지만 Rust runtime qualification·컨테이너·성능 시험은 아직 실행하지 않았다.

## 13. 기술 근거

2026-11-09 원문 확인. 아래 자료에서 runtime 기능을 확인한 것과 Ariadne에서 해당 조합을 시험한 것은 다르다.

- [Wasmtime security](https://docs.wasmtime.dev/security.html): 명시 import를 통한 외부 기능과 memory 격리, runtime 취약점·terminal output·side-channel 한계. no-WASI 설계의 근거이며 완전한 격리를 보증하지 않음.
- [실행 중단](https://docs.wasmtime.dev/examples-interrupting-wasm.html): fuel·epoch trap. host callback/compile/OS 자원은 별도 제한 필요.
- [Store limits](https://docs.wasmtime.dev/api/wasmtime/struct.StoreLimitsBuilder.html): per-memory/table 제한과 개수 제한을 합계로 혼동하지 않음. Context7의 Wasmtime 원문으로 대조.
- [Component Model](https://component-model.bytecodealliance.org/): 명시한 world/import/export와 언어 간 계약 후보. 임의 언어 패키지의 즉시 호환을 보장하지 않음.
- [Podman run](https://docs.podman.io/en/latest/markdown/podman-run.1.html): 자원·mount·network·image 실행 경계. 기본 image pull과 서버 설정을 그대로 신뢰하지 않고 고정 profile을 검증해야 함.
