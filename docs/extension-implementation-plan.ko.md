# 확장 플랫폼 구현 계획과 진행

기준: `8c3fe14`, `feat/harness-evidence-adoption`. 사용자 구현 요청에 따른 작업이다. 이후 “중간중간에 커밋하고 main에 머지하고 push” 요청으로 검증된 단위의 원격 게시·병합이 승인됐다. 보호 규칙 우회·배포·기본 Podman 환경 변경은 포함하지 않는다. 설계 정본은 [사용자 확장](extension-platform-design.ko.md)과 [Go+Rust 전환](go-rust-runtime-design.ko.md)이다.

## 순서와 종료 기준

| 순서 | 구현 단위 | 종료 기준 | 상태 |
| --- | --- | --- | --- |
| 1. E0 계약 기반 | WIT/JSON schema·공통 fixture, Go strict parser·내장 report projector·Go AST 경계 검사·실험 CLI | 실패 재현→통과, 기존 Node 계약 보존, 실제 CLI/경계/자원 정리 | 첫 구현·로컬 검사 완료 |
| 2. E0 runtime qualification | 고정 Rust/Wasmtime·image·rootless Podman profile, compile/limit/log/timeout/부모 사망 시험 | 실행 증거로만 지원 조합 등록. metadata나 hash만으로 지원 선언 금지 | worker·고정 profile·컴파일 진입 관측과 부모 사망을 포함한 실제 12개 시험 완료. 전체 지원 등록은 보류 |
| 3. E1 실행 수명 | private registry·원자적 revision·inspect/install/activate/run/disable/remove·격리 worker | crash·경합·취소·제거·원본 보존 시험 | 비실행 registry V1 구현. qualified runner·run·admission은 미구현 |
| 4. E2 좁은 조회 | 현재 권한/예산 연결, worker/2·불투명 handle | owner 재인가·scope·취소·반출·호출 한도 | 선행 조건 대기 |
| 5. E3 필요한 업무 자동화 | 개별 tool/workflow/event/외부 효과 | 개별 정책·멱등성·결과 불명·비용·복구 계약 확정 | 후속 범위 |

순서 1은 Go+Rust G0의 일부이며 전체 G0/G1이나 E0 runtime qualification 완료를 뜻하지 않는다. 사용자 code 실행은 순서 2와 3을 통과하기 전 노출하지 않는다. 실험 Go CLI의 비실행 install·선택·제거는 아래 registry V1 단위에서 제공한다. run은 계속 등록하지 않는다. 계약 authoring·내장 trusted 함수 검증은 sandbox 없이 실행 가능하다.

## 구현 경계

`runtime/go`는 외부 Go dependency 없는 실험 module로 시작했고, registry V1에서 SQLite adapter에만 `github.com/mattn/go-sqlite3 v1.14.53`을 추가했다. CGO와 C compiler가 필요하며 Node 제품의 의존성은 바꾸지 않는다. 프로젝트 `.tool-versions`는 asdf의 `golang 1.27.4`, `nodejs 24.22.2`, `rust 1.93.0`을 선택한다. 사용자 전역 기본값은 바꾸지 않는다. 현재 개발·CI 기준은 지원 중인 보안 패치 Go 1.27.4다. `go.mod`는 최소 버전이므로 실제 검증에서는 `GOTOOLCHAIN=local`과 `go env GOVERSION`으로 `go1.27.4`를 확인한다. 배포 플랫폼 적합성과 runtime qualification은 별도 gate다. 제품의 기존 Node launcher·setup·모듈 이름은 유지한다. 새로운 Go CLI는 core 전면 이식을 선언하지 않는다.

extension manifest는 실제 WASM artifact hash를 가진다. 내장 projector는 정적 Go 함수이므로 별도 builtin descriptor를 사용하며 가짜 WASM hash를 만들지 않는다. 둘은 같은 projection 입출력 계약과 fixture를 사용한다. JSON schema로 표현하기 어려운 UTF-8 byte/동일 입력 source 참조/직사각형 표 등은 문서화한 `x-*` 제약과 Go semantic validator가 담당한다. 일반 JSON schema 검증기가 해당 제약까지 자동 검사한다고 주장하지 않는다.

Go 아키텍처 gate는 AST import와 전체 파일 소유권·안쪽 의존·모듈 내부 접근·순환 의존을 검사한다. `public: true` application 공개는 Go package 단위다. 공개 타입은 projection 전송 값이며 SQL/SDK 객체·저장 entity를 노출하지 않는다. root inventory는 Go/Rust/WIT와 계약 JSON도 누락 검사한다. Rust source는 별도 `syn` AST 검사로 domain의 OS I/O·계층 역참조·WASI·native/AOT 파일 로드를 거절한다. root map은 Python 시험 도구와 Cargo/Containerfile도 소유권으로 추적한다. Cargo의 `target` 산출물은 source inventory에서 제외한다.

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

environment는 사용자가 제공한 Podman info JSON의 일부 보고된 metadata만 검사한다. 미충족이면 unsupported, 충족해 보여도 qualification-required다. 파일을 신뢰할 수 있는 실제 endpoint 증명이나 실행 허가로 승격하지 않는다. 비실행 install/activate/disable/remove는 아래 registry V1 명령을 사용한다. run은 제공하지 않는다.

### 별도 native gate

```sh
asdf install
asdf current
export GOTOOLCHAIN=local GOFLAGS=-mod=readonly
test "$(go env GOVERSION)" = go1.27.4
go env GOVERSION GOOS GOARCH CGO_ENABLED
go run ./cmd/check-architecture --root ../..
go test -count=1 -race ./...
go vet ./...
```

`.github/workflows/native.yml`은 기존 `go-version-file: runtime/go/go.mod`로 Go를 준비하고 실제 버전이 `go1.27.4`인지 확인한 뒤 같은 검사를 수행한다. CI 실행 결과는 로컬 결과와 별도다. Node 제품의 기존 gate는 그대로 유지한다. native CI는 전용 cache/temp를 만들고 종료 시 정리하며 shared cache를 사용하지 않는다. Go 1.27의 `testing.TempDir`는 `GOTMPDIR`를 사용하므로 rootless Podman VM에서 FIFO를 검사할 때는 `GOTMPDIR`와 `TMPDIR`를 모두 container 내부 전용 `/tmp`에 둔다. macOS bind mount를 테스트 임시 디렉터리로 사용하지 않는다.

이번 작업은 strict 계약·파일 검사·환경 판정·native source 발견의 실패 테스트를 먼저 실행한 뒤 구현한다. 원래 제품에 대한 기존 유효 검사와 새 경로의 검증을 구분한다. 초기 계약 단계에서 미확인이던 WIT 컴파일·Linux worker·격리 실행은 아래 후속 단계에서 따로 추적한다. 성능 baseline과 E1 실행 수명은 아직 완료하지 않았다.

현재 로컬 검증: 공유 literal fixture 43개(정상 7/거절 36), Go 전체 race 검사 119개(하위 테스트 포함)·vet·실제 AST gate·gofmt·실제 Go CLI help/project/environment, 기존 코어 `node scripts/verify.mjs` 통과. 패키지 검사에는 정상 header/hash, 변조·symlink·추가 파일·크기 초과·다른 WASM 형식 거절을 포함했다. 기존 Memory/Code production source는 무변경이므로 그 전체 suite는 반복하지 않았다. CI 정의를 추가했지만 원격 CI 통과를 의미하지 않는다.

독립 리뷰에서 float64로 작은 음수 비용이 -0으로 바뀌는 문제와 package DAG 안의 업무 context 순환 누락을 발견해 실패 재현 후 수정했다. 토큰의 미세 소수를 정수로 반올림하는 입력을 거절하고, 정확한 정수 지수 표기는 허용한다. 수정 뒤 독립 재현과 실제 저장소 gate 통과를 확인했으며 해당 E0 범위에서 미해결 Blocker/Major는 없다. 이 검토는 sandbox나 배포 적합성 검증이 아니다.

실행 로그·red/green 요약·정리 상태는 private `.harness/handoff/extension-runtime-e0/`에 보존한다. Go build/cache/temp는 실행 ID 전용 경로를 사용하고 검사 후 제거한다. 전역 Go/Rust cache·Podman machine/connection/image/volume·사용자 자료는 삭제하지 않는다.

정리 확인: 부모 전용 임시 경로는 열린 파일이 없음을 확인한 뒤 211,540 KiB(약 207 MiB)를 제거했고 잔여가 없다. 서브 작업의 전용 cache/temp와 리뷰 바이너리도 각각 제거했다. private 검증 로그는 재개 근거로 보존했고 새 컨테이너·이미지·볼륨은 생성하지 않았다. 기존 다른 작업 container 두 개와 shared/global cache는 그대로다.

## 후속: 격리 worker와 qualification 도구

요구사항은 [extension-runtime-qualification](../.harness/reqs/extension-runtime-qualification.yaml)이다. 기존 E0 계약 단계의 로컬 전용 범위는 당시 작업 기록이며, 최신 게시 요청이 현재 단위의 commit/push/PR/main 병합을 승인한다. 원격 검사는 실제 완료 뒤 별도 기록한다.

`runtime/rust`는 Rust 1.93.0·Wasmtime 36.0.20 LTS를 고정한다. domain 값, Wasmtime adapter, framed protocol adapter, binary composition을 나누고 no-WASI·단일 typed project export·raw WASM 전용 검증을 구현했다. guest 오류 문자열은 반환하지 않는다. engine memory 합계와 container RSS 한도는 서로 다른 검사다.

프로토콜은 JSON envelope frame + raw component frame 뒤, 응답을 완전히 읽고 검사한 host의 ACK `0x01`와 stdin EOF를 요구한다. decoded 1 MiB/256 KiB와 outer JSON 6배+4 KiB 한도를 분리한다. stdout 역압력 중 부모 EOF를 감시하는 thread는 출력 lock을 잡지 않는다. 독립 리뷰는 이전 flush-lock의 실제 종료 실패를 재현했고 수정 후 blocked stdout+EOF exit 2, 정상 ACK+EOF exit 0, 잘못된 ACK·추가 byte 거절을 확인했다. Go semantic projection 검사는 E1 host가 최종 소유한다.

`runtime/go/internal/extensions/adapters/podman`은 수정 가능한 옵션 대신 고정 argv를 만든다. immutable image ID, 명시 rootless 연결, network none·private PID/UTS·IPC none, read-only root·16 MiB noexec tmpfs, UID/GID 65532, drop all capabilities·no-new-privileges, 256 MiB/swap 추가 없음·1 CPU·PIDs 32, log driver none·restart off·독립 30초 제한이다. `cmd/qualification-profile`은 argv JSON만 출력하며 container나 사용자 code를 실행하지 않는다.

`tools/qualify_extension_runtime.py`는 명시 인자로 선택한 같은 기기의 rootless Podman machine만 시험하는 실험실 도구다. 공개 CLI·registry·실행 승인 시스템이 아니다. 생성 전 고유 이름과 소유 label의 intent를 private 증거에 남기고, guest bytes 전 inspect를 수행하며, 종료 확인 뒤 자기 ID/label만 제거한다. Podman이 CapDrop ALL을 개별 권한 목록으로 기록하는 표현 차이는 실제 `/proc` capability mask·NoNewPrivs·Seccomp 값과 별도로 확인한다. 설정 flag 존재만으로 실제 적용을 보고하지 않는다.

시험 image는 `runtime/extensions/Containerfile`과 vendored Cargo 의존성으로 network 없는 build를 수행했다. build context는 `runtime/rust/`, `vendor/`, `/build/vendor` source replacement를 담은 `cargo-config.toml`만 포함한다. host workspace·credential·Podman socket을 image에 넣지 않는다. 고정 base digest는 Containerfile에 있으며 실제 image ID와 명시 connection URI와 server 환경 metadata는 private 실행 증거에 기록한다. image identity는 같은 toolchain에서도 target architecture·build 결과마다 다를 수 있다.

### 실행과 검사

기존 Node 제품과 Go gate 외에 다음을 사용한다. Cargo 경로는 먼저 작업 전용 디렉터리로 설정하고 작업 종료 시 소유 여부를 확인해 정리한다.

```sh
cargo test --locked --manifest-path runtime/rust/Cargo.toml
cargo fmt --manifest-path runtime/rust/Cargo.toml -- --check
cargo clippy --locked --manifest-path runtime/rust/Cargo.toml --all-targets -- -D warnings
python3 -B tools/test_qualify_extension_runtime.py
```

native CI에 pinned Rust/Linux 검사와 Python 단위 검사를 추가한다. 실제 Podman qualification은 image·연결·helper·fixture·private 증거 경로를 명시해 별도 실행하며 CI 정의만으로 통과로 처리하지 않는다. WASM fixture는 production binary의 옵션이 아니라 ignored Rust integration test에서 명시한 전용 디렉터리로만 export한다.

| 연결 시나리오 | 현재 검사와 책임 |
| --- | --- |
| EX-S04/05 | Rust protocol·engine·worker 검사: import/export·digest·크기·fuel·합계 memory·escaped JSON·ACK/EOF. 입력 업무 의미와 source 참조·forged receipt·unknown 보존은 EX-S03/12의 Go contract gate |
| EX-S07/16 | 실제 Podman OS 한도·로그·부모 종료와 cleanup 시험. compile 시점별 부모 사망·환경별 편차는 관측 범위만 인정 |
| EX-S13 | Node/Go 공개 CLI에 사용자 install/run 추가 없음. Podman 도구는 명시 laboratory 실행만 제공 |
| EX-S14 | cold/warm·전체 RSS·시작 비용·용량 비교 baseline은 미완료. 무료·저비용·언어 전환 효율 결론 없음 |

worker의 native unit/integration 통과와 container에서 실제 격리 실행은 다른 결과다. registry/admission/CAS·crash reconciliation·공개 install/run은 E1 미구현이며, `environment`는 계속 `runtimeQualified: false`다. 단일 macOS/arm64의 Podman Linux VM 시험을 Linux 전체나 Windows 지원으로 확대하지 않는다.

현재 실행 근거: native Go race 121개(하위 테스트 포함)·vet·AST·gofmt, Rust 22개 통과/fixture export 1개 별도 실행·fmt·clippy, root inventory 검사 통과. 실제 Podman 6.0.2 Linux/arm64 rootless VM에서 8개 사례가 통과했다. cgroup의 memory/swap/CPU/PID 값, capability mask 5개=0·NoNewPrivs=1·Seccomp=2를 읽었고, 정상 projection·loop fuel·import 거절·WASM memory·output 한도·실제 OS OOM(exit 137)·attach 부모 SIGKILL 뒤 container timeout 및 log-driver none을 확인했다. 컨테이너 8개는 각각 ID/label·종료·삭제를 대조했다. private 증거는 `.harness/handoff/extension-runtime-qualification/`에 보존한다.

이 결과는 CPU/PID 상한의 실제 설정과 OS memory 위반 시험을 구분한다. 이 초기 단계에는 CPU throttle/PID 고갈·WIT 정본 타입 검사가 없었고 후속 단위에서 추가한다. compile 중 시점별 부모 사망, 다른 OS/architecture, WIT binding 생성과 사용자 패키지 컴파일, native/WASM cold/warm 성능은 여전히 미확인이다. server URI·version/kernel/architecture snapshot을 암호학적 server identity나 E1 admission 보장으로 부르지 않는다. 전체 E0 지원 조합 등록과 E1은 계속 미완료다.

최종 Python 도구는 12개 테스트를 통과했다. 초기 전체 8개 Podman 사례와, URI/identity 고정·입력 전송 deadline 보완 뒤 pure 1건을 구분해 보존한다. 이후 stdout EOF 읽기를 bounded reader로 옮긴 마지막 변경은 같은 실제 프로세스 기반 ACK/EOF 회귀 검사로 검증했으며, 전체 8개 실제 시험을 다시 실행한 것은 아니다. 독립 리뷰에서 발견한 stdin write 대기와 stdout read 대기는 공통 25초 host deadline으로 제한했다. 최종 재검토 범위의 미해결 Blocker/Major는 없다.

정리: 전용 Cargo/Go cache·target·vendor·fixture·helper 등 2,812,184 KiB(약 2.68 GiB)를 열린 파일 없음 확인과 로그 보존 뒤 제거했다. 시험 container 9개와 이 작업이 처음 내려받거나 만든 rootless image 3개를 각각 ID·소유 근거·사용 여부로 확인해 제거했고 rootless container/image 목록이 비어 있다. 이미지 크기 합계를 실제 회수 용량으로 주장하지 않는다. 기존 rootful container·Podman machine/connection·전역 cache·사용자 자료·private 증거는 보존했다. 실행 적합성 증거는 남기되 image를 계속 설치해 두지는 않는다.

## 후속: CPU/PID 실제 집행과 WIT 정본 검사

CPU/PID 상한 설정만 읽던 검증을 실제 위반 시험으로 확장한다. 새로운
`runtime/rust/examples/qualification-os-probe.rs`는 명시된 실험 이미지 안에서만
실행하는 신뢰된 fixture다. 프로세스 생성 전에 정확한 cgroup 한도와 capability
mask·NoNewPrivs·Seccomp를 검사한다. CPU 자식 2개는 각각 단조 시계 기준 3초 이내의
연산만 수행한다. PID 자식은 중첩 생성 없이 최대 40회의 직접 생성만 시도한다.
모든 자식을 회수한 뒤에만 커널 counter의 전후 값을 반환한다.

CPU는 `nr_throttled`와 `throttled_usec` 증가를 모두 요구한다. PID는
`pids.events max` 증가와 실제 EAGAIN 11, 생성 시도·실패·회수 수의 일치를 요구한다.
`spawnAttempts`는 프로세스 생성 API 시도 수이며 특정 fork syscall 횟수가 아니다.
반환 JSON의 미지 필드·boolean·음수·uint64 초과·미회수 상태는 거절한다.
이 값은 한도 집행의 증거이며 처리량이나 언어 간 성능 비교가 아니다.

독립 리뷰에서 `read ack || :`가 시작 신호 전 EOF에도 부하를 실행하는 문제를
재현했다. 성공한 read 뒤에만 실행하도록 고치고 실제 셸 명령의 빈 stdin 회귀
검사로 차단을 확인했다. 수정 뒤 최종 소스의 실제 Podman 시험에서 CPU·PID 사례를 포함한 10개가 모두 통과했다.

WIT 정본은 기존 lockfile에 있던 `wit-parser 0.236.1`을 개발 의존성으로 재사용해
문법과 타입을 resolve한다. world/version·단일 project 함수·import 없음·입출력
시그니처를 실제 worker 계약과 대조하며 잘못된 변형을 거절한다. 이 검사는
SDK binding 생성이나 임의 언어 사용자 패키지 빌드의 검증을 대신하지 않는다.

최신 검증과 resource 소유 기록은 private
`.harness/handoff/extension-runtime-e0-limits/`에서 관리한다. 공개 install/run과
E1 registry/admission은 이 시험 도구로 활성화하지 않는다.

이번 후속 단위의 로컬 검사: Rust 24개·example 파서 1개·명시 fixture export 1개,
fmt·clippy, Python 18개, 코어 gate가 통과했다. Go 소스는 변경하지 않아 기존
동일 Go 소스의 race 검사 121개 및 vet·AST 통과 근거를 재사용했고 실제 profile helper는
전용 경로로 다시 빌드했다. 원격 CI 결과는 게시 시점에 따로 확인한다.

최종 실행 `fbd3ebe904024c86`에서 기존 8개와 새 CPU/PID 사례를 모두 재시험했다.
CPU kernel counter는 nr_throttled 0→30, throttled_usec 0→1,373,377로 증가했고
자식 2개를 모두 회수했다. PID는 max 거절 counter 0→1, 생성 32회 시도 중
EAGAIN 11로 1회 실패했고 생성된 자식 31개를 전부 회수했다. 이 값은 해당
Linux/arm64 Podman VM의 단일 집행 시험 기록이다. 처리량·성능 SLO가 아니다.
컨테이너 10개는 각각 ID/label·종료·삭제를 확인했고 미해결 대상은 0개였다.

독립 리뷰는 실제 시험의 소스 hash 5개와 현재 파일의 일치, WIT/CI/map 연결 및
결과를 대조했으며 검토 범위의 미해결 Blocker/Major는 없다. 전체 E0 지원 등록,
compile 중 부모 사망의 시점별 관측, WIT SDK/binding 생성·사용자 패키지 빌드,
다른 환경과 성능 baseline·E1은 계속 남아 있다.

후속 단위 정리: 열린 파일이 없음을 확인한 전용 cache·target·vendor·fixture·helper
1,985,004 KiB(약 1.89 GiB)를 제거했다. 이 작업이 준비한 이미지 3개도 ID와
사용 여부를 확인해 제거했고 rootless image/container 목록은 비어 있다. 기존
rootful 컨테이너 두 개의 목록은 작업 전후 같고 전역 cache·machine·connection과
사용자 자료·private 증거는 보존했다.

## 후속: 컴파일 진입 관측과 부모 사망

PR #8은 main `b2d516c`에 병합했으며 검증한 tree와 병합 tree가 일치한다.
다음 단위는 compile 호출 경계의 관측과 attach 부모 사망 뒤 종료를 확인한다.
이 관측으로 SIGKILL 순간 compiler 내부에 있었다고 단정하지 않는다.

engine adapter가 `Component::new` 직전 CompileStarted와 모든 정상/오류 반환
직후 CompileFinished를 알린다. composition만 고정된 비민감 stderr 표식을
best-effort로 출력하고 domain·stdout frame·ACK·권한 계약은 유지한다.
기존 execute는 관측 없는 호환 진입점으로 남긴다. 로그 출력 실패가 응답
프로토콜을 panic으로 바꾸지 않는지 검사한다.

실험 도구는 작은 표식을 EOF 전에 읽고 부분 줄·중복·역순·초과를 거절한다.
고정 fixture의 정상 compile과 응답·ACK·종료·정리를 먼저 같은 Podman profile에서 확인한 뒤, 시작
관측 후 attach 프로세스만 종료한다. kill 전에 Finished·응답이 관측되면
inconclusive로 남기고 성공 사례 수에 넣지 않는다. marker 미관측은 사건
미발생의 증거가 아니므로 `phaseAtKill`은 항상 unknown이다.

종료 판정은 자연 종료 관측·비OOM·CID/label 정리·I/O 회수를 각각 확인한다.
container 시작부터 종료까지의 수명과 kill 이후 대기 시간을 구분하며 실제
30초 profile과 측정 허용 오차 5초를 별도 기록한다. 이 허용 오차는 profile
확대나 지연 SLO가 아니다. 구현·실제 시험·CI가 끝나기 전에는 통과로 쓰지 않는다.

정상 대조 시험은 수동 선행조건으로 두지 않고 도구 안에서 강제한다. 대조
artifactDigest와 미리 읽은 종료 실험 bytes의 digest가 다르면 실험 대상을
생성하지 않는다. 기존 10개 + 정상 compile 대조 + 부모 사망 관측으로 최종
실행 결과는 12개다. 사례 수 증가 자체가 지원 조합 등록을 뜻하지 않는다.

최종 소스의 실제 실행 `70d0d1eaa5a94574`에서 12개가 모두 통과했고 소유 container
12개의 종료·삭제와 미해결 0개를 확인했다. 정상 대조는 같은 artifact digest로
응답·ACK·exit 0·비OOM을 통과했다. 후속 attach SIGKILL은 -9, worker는 exit 2로
자연 종료했고 강제 cleanup 이전 종료와 비OOM을 확인했다. kill 이후 관측 대기는
190.169 ms, container metadata의 전체 수명은 514.553 ms였다. 이는 단일 실행
기록이며 지연 SLO나 성능 개선 수치가 아니다. 시작 표식만 관측됐고 kill 전 종료
표식과 stdout은 미관측이지만, `phaseAtKill: unknown`을 그대로 남긴다.

로컬 Rust 검사 28개·example 파서 1개·명시 fixture export 1개·fmt·clippy,
Python 28개, 기존 Node 소스의 코어 gate가 통과했다. 이전 관측 없는 stderr
reader가 EOF까지 표식을 기다리는 실패와, 정상 compile 대조 없이 종료 대상을
시작하던 실패를 재현하고 수정했다. Go와 Memory/Code 소스는 변경하지 않았다.
동일 소스의 기존 검증 근거를 재사용하며 새 원격 CI 결과는 별도 확인한다.

후속 관측 단위의 정리: 열린 파일 없음 확인 뒤 전용 cache·target·vendor·fixture·
helper 2,011,660 KiB(약 1.92 GiB)를 제거했다. 이 작업 소유 image 3개도 정상
rmi로 제거했고 rootless image/container 목록이 비어 있다. 다른 작업 rootful
컨테이너 목록은 전후 같으며 전역 cache·machine/connection·사용자 자료와
private 검증 근거는 보존했다. 독립 리뷰에서 소스 6개와 fixture bytes hash 및
실제 receipt/inspect의 CID·image·label·종료·정리 일치를 확인했다.

## 후속: 비실행 패키지 레지스트리 V1

현재 단위의 정본은 [extension-registry](../.harness/reqs/extension-registry.yaml)다.
선행 E0 REQ의 공개 install 제외는 이 실험 Go CLI의 비실행 설치에 한해서만
대체한다. Node launcher에는 연결하지 않는다. 아래 명령은 `runtime/go`에서 실행한다.

```sh
go run ./cmd/Ariadne extensions install --package /path/to/package --workspace /path/to/checkout
go run ./cmd/Ariadne extensions inspect example/team-report --workspace /path/to/checkout
go run ./cmd/Ariadne extensions activate example/team-report --digest SHA256 --expected-revision 1 --workspace /path/to/checkout
go run ./cmd/Ariadne extensions disable example/team-report --expected-revision 2 --workspace /path/to/checkout
go run ./cmd/Ariadne extensions remove example/team-report --digest SHA256 --expected-revision 3 --workspace /path/to/checkout
```

`--workspace`를 생략하면 현재 디렉터리다. 출력의 실제 digest와 revision을 다음
명령에 사용한다. 성공은 0, 명령·인자 오류는 2, 작업 실패는 1이다. 중복·알 수
없는 flag와 여분 위치 인자는 거절한다. 기존 package inspect·내장 project·환경
metadata 조회는 유지하며 help·E0·지원하지 않는 run은 registry를 만들거나 worker를
시작하지 않는다. registry가 없는 ID 조회도 DB를 만들지 않고 `NOT_INSTALLED`다.

설치는 `manifest.json`, `extension.wasm`, 선택적 `README.md`·`LICENSE`만 각각
한 번 읽는다. UTF-8·개별/합계 크기·regular file·symlink·실행 mode·descriptor 변경을
검사하고 captured bytes를 private 저장소에 게시한다. source 경로를 다시 열지 않는다.
manifest는 Go `encoding/json.Marshal`의 기본 escaping과 기존 struct 필드 순서의
compact JSON으로 canonicalize한다. package digest는
`ariadne.package/1` 뒤 NUL, 이름순 파일별 filename과 content의 uint32 big-endian
byte 길이와 bytes를 SHA-256에 넣는다. manifest의 공백·key 순서는 digest에 영향을
주지 않지만 선택 파일의 존재와 내용은 영향을 준다. escaping 후 canonical manifest의
32 KiB 한도와 canonical manifest로 바꾼 패키지 전체의 16 MiB 한도도 다시 검사한다. component header와 hash는
실행 적합성 검사가 아니다.

저장은 `.ariadne/private/extensions/registry.sqlite`와 `artifacts/<digest>`, `staging/`다.
디렉터리는 0700, DB·파일·존재하는 SQLite sidecar는 소유자의 regular 0600이어야 한다.
기존 경로를 chmod하지 않는다. canonical root부터 checkout까지 각 실제 상위 디렉터리를
Lstat으로 순서대로 확인한다. owner는 root 또는 현재 UID여야 하고 group/other 쓰기는
sticky bit가 있을 때만 허용한다. checkout 자체는 현재 UID 소유여야 한다. 열린 handle의
모든 작업에서도 이 ancestry를 다시 검사한다. 이는 POSIX owner/mode 경계이며 ACL로
허용한 추가 쓰기 권한, hostile mount와 root 및 같은 UID의 악성 writer는 운영 전제 밖이다.
ACL을 검사하거나 차단한다고 주장하지 않는다. 실제 선택한 checkout의 canonical path·UID·device·inode를
기록하므로 이동하거나 복사한 저장소는 자동 재결합하지 않는다. schema가 정확히 1인지
모든 조회·변경 transaction에서 확인한다. 이미 열린 V1 handle도 schema 2를 거절한다.
기존 빈 파일·손상 DB·알 수 없는 schema는 초기화하거나 덮어쓰지 않는다.

SQLite는 DELETE journal·synchronous FULL·모든 연결의 foreign_keys·1초 busy timeout과
immediate transaction을 사용한다. 협력하는 writer는 같은 DB lock으로 직렬화한다.
새 설치는 head revision을 올리고 기존 선택을 유지한다. 같은 설치 digest는 멱등이며
revision을 올리거나 활성 상태를 바꾸지 않는다. activate·disable·remove는 조회한
expected revision이 같아야 한다. 마지막 패키지를 지워도 head를 남겨 이전 revision의
재사용을 막는다. 유효한 DB에서 한 번도 등록되지 않은 ID의 inspect는 revision 0과
빈 패키지 및 orphan·staging 목록을 반환한다. revision 0은 설치나 활성화 권한이 아니다.

설치는 fsync한 staging을 digest 디렉터리로 원자 게시하고 부모 디렉터리를 sync한 뒤
DB를 commit한다. 파일과 DB는 함께 원자적이지 않다. 게시 후 commit 전 crash의 orphan과
남은 staging은 조회만 하며 자동 등록·실행·삭제하지 않는다. 같은 digest의 orphan은
모든 파일과 bytes가 같을 때만 재사용한다. commit 실패를 이유로 게시한 파일을
삭제하지 않는다. 같은 OS 계정의 악성 writer와 mount 전체에 대한 보호는 보장하지 않는다.

remove는 활성 선택을 거절한다. 비활성 선택은 지우고 `removing` 의도와 revision을 먼저
commit한 뒤, 새 immediate transaction에서 참조를 재확인하고 아는 소유 파일만 지운다.
정리 실패는 `CLEANUP_PENDING`과 `removing`을 유지한다. 현재 revision으로 같은 remove를
다시 요청하면 부분 삭제·이미 없는 파일을 이어서 처리한다. 예상하지 못한 파일과
symlink는 보존하며 같은 digest의 재설치·활성화는 `REMOVAL_PENDING`으로 거절한다.
다른 digest의 새 선택과 revision은 정리가 덮어쓰지 않는다.

시작 전 취소는 변경을 시작하지 않는다. filesystem을 바꾸는 transaction이 시작된 뒤에는
호출 context 취소가 DB lock을 조기에 해제하지 않게 한다. 이미 시작한 전이가 durable하게
끝날 수 있으며 실제 commit 결과를 반환한다. backup은 모든 writer를 멈추고 private
디렉터리 전체를 함께 복사한다. DB 파일만 복사하는 live backup CLI는 제공하지 않는다.

모든 package·registry 결과는 `runtimeQualified: false`다. activation은 정확한 digest의
선택일 뿐 실행·자료 접근·자동 실행 권한이 아니다. V1에는 invocation·runner·worker 종료
counter가 없다. qualified host admission·격리 runner·run과 실행 회수·author SDK 및 전체
E1은 후속 단위다.

현재 소스에서 native macOS/arm64 Go 1.24.5 race 181개(하위 테스트 포함)·vet·AST·gofmt와
실제 Go 실행 파일의 CLI 검사 12개가 통과했다. 선택 파일 UTF-8의 기존 실패와 취소 시
DB lock이 먼저 풀리는 변형의 실패를 각각 분리한 복사본에서 재현했다. 고정 Go 1.24.5의
별도 rootless Podman Linux/arm64 환경에서는 extensions·composition race 검사 137개가
통과했고 exit 0·비OOM·소유 container 삭제를 확인했다. 이는 registry의 Linux 통합 검사이며
worker qualification이나 Linux 전체 지원 선언이 아니다. 독립 리뷰에서 canonical escaping 후 크기 한도와 쓰기 가능한 ancestry 및 사라지는 SQLite
sidecar의 이중 조회를 보완했다. 각 실패를 재현한 뒤 수정 소스의 재리뷰에서 남은 주요
지적은 없다. 코어 inventory의 불필요한 go.sum map 항목은 제거했고 경계 검사 11개와 Go
AST를 통과했다. 이전 코어 기본 병렬 검사는 서로 다른 기존 평가 fixture의 ETIMEDOUT으로
두 번 실패했다. 같은 23개 파일의 제한 동시성 검사는 220/220 통과했으며 기본 gate와
별도 근거로 보존했다. 2026-11-16 재개 시 검증 대상 77개 파일의 SHA-256이 기존 근거와
모두 일치했고, Node 24.22.2의 원래 `node scripts/verify.mjs`도 설정 변경 없이 통과했다.
작업 전용 native cache와 Linux container·image·임시 경로는 정리했다. 공유 cache와
소유권이 불명확한 중단 fixture 두 개는 보존했다. 정확한 commit의 독립 소스 리뷰와
[PR #10](https://github.com/YouSangSon/Ariadne/pull/10)은 최종 합성 소스의 독립 전달 리뷰와
원격 검사 11개를 통과하고 2026-11-16 보호된 main `18f68dcc73f483e58ff65ee0b766781427468ab5`에
일반 병합됐다. 이 게시 완료는 비실행 registry V1 단위에 한정한다. 전체 E1의 runner/run과
사용자 실행 지원은 여전히 미구현이다.

[PR #10](https://github.com/YouSangSon/Ariadne/pull/10)의 첫 CI에서 Go 포맷·AST·race·vet와
별도 Rust worker 검사는 통과했지만 native job의 마지막 cache 정리가 실패했다.
읽기 전용 Go module cache를 일반 삭제로 지우던 문제를 수정해 전용 `GOMODCACHE`를
명시하고 `go clean -modcache` 뒤에만 전용 경로를 삭제한다. 검사 실패 코드는 유지하며
정리만 실패한 경우도 성공으로 바꾸지 않는다. 기존 cache의 오프라인 복사본에서 이전
실패와 새 정리·오류 코드 보존을 확인했다. 이는 cache 정리 검증이며 복사에 사용한
다른 module 버전의 runtime 검증을 뜻하지 않는다. 실제 E1 의존성은 v1.14.53 그대로다.

전체 제품 `verify`는 기존 Memory 패키지의 Hono 의존성 감사에서 실패했다.
해당 취약점은 별도 보안 [PR #11](https://github.com/YouSangSon/Ariadne/pull/11)에서 수정해 main에
병합했으며 E1 브랜치는 그 변경을 일반 merge로 통합했다. 이 PR의 Node lockfile은 main과
같다. 합쳐진 최종 소스의 전체 원격 검사 11개와 독립 전달 리뷰를 확인한 뒤 PR #10을
병합했다. 로컬 Memory backup 15초 제한의 기존 timeout과 G0 자원 baseline 미완료는
원격 통과와 별도로 남겨 둔다.
