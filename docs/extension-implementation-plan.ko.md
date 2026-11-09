# 확장 플랫폼 구현 계획과 진행

기준: `8c3fe14`, `feat/harness-evidence-adoption`. 사용자 구현 요청에 따른 작업이며 원격 게시·MSA 배포는 포함하지 않는다. 설계 정본은 [사용자 확장](extension-platform-design.ko.md)과 [Go+Rust 전환](go-rust-runtime-design.ko.md)이다.

## 순서와 종료 기준

| 순서 | 구현 단위 | 종료 기준 | 상태 |
| --- | --- | --- | --- |
| 1. E0 계약 기반 | WIT/JSON schema·공통 fixture, Go strict parser·내장 report projector·Go AST 경계 검사·실험 CLI | 실패 재현→통과, 기존 Node 계약 보존, 실제 CLI/경계/자원 정리 | 첫 구현·로컬 검사 완료 |
| 2. E0 runtime qualification | 고정 Rust/Wasmtime·image·rootless Podman profile, compile/limit/log/timeout/부모 사망 시험 | 실행 증거로만 지원 조합 등록. metadata나 hash만으로 지원 선언 금지 | 미구현 |
| 3. E1 실행 수명 | private registry·원자적 revision·inspect/install/activate/run/disable/remove·격리 worker | crash·경합·취소·제거·원본 보존 시험 | 미구현 |
| 4. E2 좁은 조회 | 현재 권한/예산 연결, worker/2·불투명 handle | owner 재인가·scope·취소·반출·호출 한도 | 선행 조건 대기 |
| 5. E3 필요한 업무 자동화 | 개별 tool/workflow/event/외부 효과 | 개별 정책·멱등성·결과 불명·비용·복구 계약 확정 | 후속 범위 |

순서 1은 Go+Rust G0의 일부이며 전체 G0/G1이나 E0 runtime qualification 완료를 뜻하지 않는다. 사용자 code 실행은 순서 2와 3을 통과하기 전 노출하지 않는다. 현재 CLI에는 install/run 명령을 등록하지 않는다. 계약 authoring·내장 trusted 함수 검증은 sandbox 없이 실행 가능하다.

## 구현 경계

`runtime/go`는 외부 Go dependency 없는 실험 module로 시작한다. 현재 개발 환경의 Go 1.24.5로 재현하고 배포용 toolchain 적합성·보안 기준은 runtime qualification 때 별도로 갱신한다. 제품의 기존 Node launcher·setup·모듈 이름은 유지한다. 새로운 Go CLI는 core 전면 이식을 선언하지 않는다.

extension manifest는 실제 WASM artifact hash를 가진다. 내장 projector는 정적 Go 함수이므로 별도 builtin descriptor를 사용하며 가짜 WASM hash를 만들지 않는다. 둘은 같은 projection 입출력 계약과 fixture를 사용한다. JSON schema로 표현하기 어려운 UTF-8 byte/동일 입력 source 참조/직사각형 표 등은 문서화한 `x-*` 제약과 Go semantic validator가 담당한다. 일반 JSON schema 검증기가 해당 제약까지 자동 검사한다고 주장하지 않는다.

Go 아키텍처 gate는 AST import와 전체 파일 소유권·안쪽 의존·모듈 내부 접근·순환 의존을 검사한다. `public: true` application 공개는 Go package 단위다. 공개 타입은 projection 전송 값이며 SQL/SDK 객체·저장 entity를 노출하지 않는다. root inventory는 Go/Rust/WIT와 계약 JSON도 누락 검사한다. Rust의 AST/실행 경계 검사는 실제 Rust source 도입 단계에서 구현한다.

## 초기 환경 관측

2026-11-09 관측: Go 1.24.5 darwin/arm64, Rust/Cargo 1.93.0, Node 24.22.2, Podman client 6.1.4/server 6.0.2. 현재 기본 Podman endpoint는 rootful이다. 기존 `podman-machine-default` 연결을 명시한 read-only info에서 rootless=true·seccomp=true를 확인했다. 기본 연결은 바꾸지 않았다. rootless 쪽 image 목록은 비어 있어 검증된 확장 runtime image는 아직 없다. 다른 작업의 실행 container 2개를 보존했다.

환경 metadata는 자원 상한·로그 비기록·attach·endpoint 정체성·부모 독립 종료의 시험 결과가 아니다. 실험 CLI의 environment 검사는 metadata가 적합해 보여도 `runtimeQualified: false`를 유지한다. 초기 template 기반 Podman 조회 한 건은 필드 이름 차이로 실패하여 JSON 출력으로 대조했으며 지원 판정에 사용하지 않았다.

## 실행·검증 상태

### 실험 CLI

다음은 `runtime/go`에서 실행한다. 기존 Node 제품의 `Ariadne` 명령을 바꾸지 않는다.

```sh
go run ./cmd/Ariadne --help
go run ./cmd/Ariadne extensions project --input ../../contracts/extensions/v1/fixtures/input-unknown.json
go run ./cmd/Ariadne extensions inspect --package /path/to/package
go run ./cmd/Ariadne extensions environment --info /path/to/private/podman-info.json
```

project는 신뢰된 내장 Go 함수를 실행해 구조화된 파생 JSON만 반환한다. inspect는 고정 파일명·크기·regular file·component header·실제 artifact SHA-256을 검사한다. WASM import/export·WIT 일치·code 안전성까지 검사한 것이 아니므로 `component-header-only`, `runtimeQualified: false`로 보고한다. `os.OpenRoot`로 디렉터리 밖 traversal을 제한하고 nonblocking open과 descriptor 검사로 비정상 파일을 거절한다. 첫 지원 검증 대상은 native macOS/Linux이며 같은 OS 계정의 악성 프로세스·mount 전체에 대한 sandbox가 아니다.

environment는 사용자가 제공한 Podman info JSON의 일부 보고된 metadata만 검사한다. 미충족이면 unsupported, 충족해 보여도 qualification-required다. 파일을 신뢰할 수 있는 실제 endpoint 증명이나 실행 허가로 승격하지 않는다. install/activate/run/disable/remove는 아직 명령 목록에 없다.

### 별도 native gate

```sh
go run ./cmd/check-architecture --root ../..
go test -race ./...
go vet ./...
```

`.github/workflows/native.yml`은 Go module에 고정한 개발 toolchain으로 같은 검사를 수행하도록 정의했다. CI 실행 결과는 로컬 결과와 별도다. Node 제품의 기존 gate는 그대로 유지한다. native CI는 전용 cache/temp를 만들고 종료 시 정리하며 shared cache를 사용하지 않는다.

이번 작업은 strict 계약·파일 검사·환경 판정·native source 발견의 실패 테스트를 먼저 실행한 뒤 구현한다. 원래 제품에 대한 기존 유효 검사와 새 경로의 검증을 구분한다. schema/WIT 실 compiler 검증, Linux CI, runtime qualification, 성능 baseline은 실제 실행 전 미확인이다.

현재 로컬 검증: 공유 literal fixture 43개(정상 7/거절 36), Go 전체 race 검사 119개(하위 테스트 포함)·vet·실제 AST gate·gofmt·실제 Go CLI help/project/environment, 기존 코어 `node scripts/verify.mjs` 통과. 패키지 검사에는 정상 header/hash, 변조·symlink·추가 파일·크기 초과·다른 WASM 형식 거절을 포함했다. 기존 Memory/Code production source는 무변경이므로 그 전체 suite는 반복하지 않았다. CI 정의를 추가했지만 원격 CI 통과를 의미하지 않는다.

독립 리뷰에서 float64로 작은 음수 비용이 -0으로 바뀌는 문제와 package DAG 안의 업무 context 순환 누락을 발견해 실패 재현 후 수정했다. 토큰의 미세 소수를 정수로 반올림하는 입력을 거절하고, 정확한 정수 지수 표기는 허용한다. 수정 뒤 독립 재현과 실제 저장소 gate 통과를 확인했으며 해당 E0 범위에서 미해결 Blocker/Major는 없다. 이 검토는 sandbox나 배포 적합성 검증이 아니다.

실행 로그·red/green 요약·정리 상태는 private `.harness/handoff/extension-runtime-e0/`에 보존한다. Go build/cache/temp는 실행 ID 전용 경로를 사용하고 검사 후 제거한다. 전역 Go/Rust cache·Podman machine/connection/image/volume·사용자 자료는 삭제하지 않는다.

정리 확인: 부모 전용 임시 경로는 열린 파일이 없음을 확인한 뒤 211,540 KiB(약 207 MiB)를 제거했고 잔여가 없다. 서브 작업의 전용 cache/temp와 리뷰 바이너리도 각각 제거했다. private 검증 로그는 재개 근거로 보존했고 새 컨테이너·이미지·볼륨은 생성하지 않았다. 기존 다른 작업 container 두 개와 shared/global cache는 그대로다.
