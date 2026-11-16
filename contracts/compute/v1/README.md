# 숫자 기반 co-change 계산 계약 v1

이 계약은 신뢰된 Code 계산의 JSON 값과 G2a 순수 라이브러리 및 G2b 프로세스 경계를 정의한다. 내부 Go 어댑터가 설치 manifest로 지정한 Rust 실행 파일을 호출한다. 기존 TypeScript 제품과 공개 CLI는 이 경로를 호출하지 않는다. DB 게시·기본 backend 전환·배포 설치기는 후속 범위다. 전체 설계는 [§5–6](../../../docs/go-rust-runtime-design.ko.md)에 있다.

## 요청과 응답

요청은 `protocol,operation,requestId,inputDigest,payload`를 모두 갖는다. 버전은 `ariadne.compute/1`, operation은 `cochange-counts/1`이다. requestId는 ASCII 영숫자·밑줄·하이픈 1..128자다. digest는 소문자 64자리 SHA-256이다. 둘은 상관관계를 검사하며 인증하지 않는다. payload에는 경로나 credential을 넣지 않는다.

payload는 `fileCount,commits`만 허용한다. fileCount는 0..37,500, commits는 최대 1,500개다. 각 commit에는 0 이상 fileCount 미만의 ID를 최대 25개 넣으며 중복 없이 오름차순이어야 한다. 빈 입력·빈 commit을 허용한다. 호스트는 원본 commit을 중복 제거하고 **포함 파일 필터 전에** unique 26개 이상을 제외한다. 승인된 commit에서 실제 포함된 경로의 합집합만 UTF-16 순으로 ID에 대응한다. 제외되거나 한 번도 쓰이지 않은 indexed 경로는 ID 한도를 소비하지 않는다.

성공 응답은 같은 네 상관 필드와 `status:"ok",frequencies,pairs`를 갖는다. frequencies 길이는 fileCount이며 각 빈도는 commit 수 이하다. pair는 `[a,b,count,firstSeenOrdinal]`이다. a<b이고 `(a,b)` 오름차순·중복 없음·양의 count를 만족한다. count는 양 끝 파일의 빈도를 넘지 않는다. ordinal은 0..pair 수-1의 중복 없는 순열이다. 첫 등장 순번은 commit 순서와 각 commit의 i<j 순회를 따른다. 응답의 pair 수는 최대 450,000개다.

오류 응답에는 네 상관 필드와 `status:"error",code`만 있다. code는 response schema의 고정 enum이며 counts나 자유 형식 메시지를 담지 않는다. `DecodeResponse/decode_response`는 **검증한 기대 요청**을 필수로 받고 상관 필드와 입력 범위를 확인한다. 결과 검증은 구조·범위만 검사하며 전체 집계 알고리즘을 재실행하지 않는다. 따라서 올바른 형식의 의미상 틀린 결과를 단독으로 인증하는 기능은 아니다.

## JSON Schema 밖의 필수 검증

두 schema는 값의 형태를 설명한다. 일반 JSON Schema만으로 원문 숫자 표기나 중복 키를 검증할 수 없다. Go/Rust codec의 다음 검사도 계약의 필수 부분이다.

| 검사 | 규칙 |
| --- | --- |
| 원문 크기 | 요청 16 MiB, 응답 32 MiB를 **파싱 전** 거절 |
| 문자열 인코딩·문서 경계 | 유효 UTF-8, JSON 값 하나, 뒤에는 공백만 허용. 짝 없는 UTF-16 surrogate escape는 거절하며, 올바른 high/low 쌍과 실제 U+FFFD는 일반 문자열로 검증 |
| 숫자 원문 | `0\|[1-9][0-9]*`에 맞고 u32 이내. -0·음수·소수·지수·overflow 거절 |
| object key | 대소문자 구분, escaped key를 해석한 뒤 중복 거절, 모든 계층의 unknown/missing/null 거절 |
| 입력 관계 | commit ID 범위·오름차순·중복 없음 |
| 결과 관계 | 빈도 길이·상한, pair 순서·ID·count·ordinal 순열 |
| canonical hash | payload key 순서 `fileCount,commits`, compact UTF-8 decimal JSON, 빈 배열 `[]`, null 없음 |

원문 envelope의 공백과 payload key 순서는 달라도 된다. canonical payload로 digest를 재계산한다. tiny의 bytes는 `{"fileCount":3,"commits":[[0,1],[1,2]]}`이고 SHA-256은 `73c33205d9b30fdfdf31e08236aaf51c309f31ebab0c6e98910f013f94e732d6`이다. Python 표준 hashlib로 별도 계산했고 Go·Rust·TS가 같은 값을 검사한다.

요청의 잘못된 타입·JSON·digest·필드·도메인 값은 `INVALID_INPUT`, 버전과 operation의 타입을 모두 확인한 뒤 문자열 값의 불일치는 `UNSUPPORTED_VERSION`, 크기/개수 상한 초과는 `LIMIT_EXCEEDED`다. 응답의 잘못된 값·JSON·버전·상관관계는 `PROTOCOL_ERROR`, 응답 크기/개수 상한 초과는 `LIMIT_EXCEEDED`다. 기대 요청 자체가 잘못되면 요청 검증 오류를 반환한다. 유효한 `status:error`의 code는 원문 enum을 유지한다. 파싱 오류의 원문 메시지는 반환하지 않는다. 버전 문자열이 다르더라도 operation이 null이면 먼저 `INVALID_INPUT`으로 거절한다. Go의 JSON decoder가 짝 없는 surrogate를 대체 문자로 정규화하기 전에 원문 escape를 검사한다. 정상 surrogate 쌍·`\ufffd`·실제 대체 문자·문자열 안의 escaped backslash는 정규화 없이 유지한다. 이들로 만든 잘못된 버전 문자열은 타입 오류가 아닌 `UNSUPPORTED_VERSION`으로 분류하는 fixture를 둔다.

## 공통 fixture와 실제 TypeScript 비교

`fixtures/cases.json`은 정상 요청/응답/canonical bytes/SHA와 거절 원문·기대 오류 code를 열거한다. 잘못된 JSON·UTF-8 파일도 의도적으로 `.json` 확장자를 쓴다. 전 파일을 일반 JSON formatter로 다시 저장하면 안 된다. 작은 빈도·쌍·ordinal 값은 손으로 계산한 literal이다. 최대 450,000 pair는 파일로 저장하지 않고 각 언어 테스트에서 disjoint 25-ID commit 1,500개로 생성하고 수학적 개수와 빈도 1을 확인한다.

`packages/code/scripts/generate-compute-fixtures.ts --check`는 실제 `computeCoChanges`, `fileEntityId`, `relationId`를 import한다. literal counts를 첫 등장 순서로 복원한 결과와 실제 TS의 directed pair·정렬·score를 정확히 비교한다. provenance의 `toFixed(2)`와 ID도 비교하며 5/8의 `0.63` 및 독립 SHA-1 literal을 검사한다. `ts-oracle.json`의 소스 hash·Node·ICU·locale는 자동 갱신하지 않는다. source 또는 환경이 달라지면 검토 후 명시적으로 재생성한다.

검증 명령은 다음과 같다. 캐시·임시 경로는 작업 소유 경로로 지정한다.

```sh
(cd runtime/go && go test ./internal/code/...)
cargo test --locked --manifest-path runtime/rust/Cargo.toml -p ariadne-compute
(cd packages/code && npx --no-install tsx scripts/generate-compute-fixtures.ts --check)
(cd packages/code && npx --no-install tsx --test tests/compute-contract.test.ts)
```

TypeScript snapshot은 Node 24.22.2·ICU 78.3·en-US 기준이다. npm의 로컬 11.9.0과 CI 11.19.1 차이는 npm 실행 환경의 차이이며 컴파일러나 fixture 동등성의 근거로 합치지 않는다. Go locale 구현·SQLite 게시·incremental proven confidence·savepoint는 G4 범위다. 이 오프라인 비교를 그 기능의 완료 근거로 쓰지 않는다. 프로세스 수명 검증은 아래 G2b 검사를 별도로 실행한다. 성능 우위는 주장하지 않는다.


## G2b framed process와 설치 정체성

`runtime/go/internal/platform/computeprocess.Runner`는 Code를 import하지 않고 opaque bytes의 실행과 회수를 소유한다. Code의 `adapters/computeprocess.Counter.CountCoChanges`가 기존 domain·computewire를 조합한다. 입력과 결과 JSON은 앞의 G2a 계약을 유지한다. 원문 앞에 u32 big-endian 4byte 길이를 붙이며 한 프로세스에서 요청 하나와 응답 하나만 처리한다. 요청 16 MiB·응답 32 MiB를 할당 전에 검사한다. stdout은 frame 전용이다.

`Manifest`에는 절대 경로, GOOS, GOARCH, protocol, operation, SHA-256을 주입한다. runner는 실행 전 두 번 파일을 확인하며 마지막 확인 뒤 context를 다시 검사한다. symlink·디렉터리·FIFO 등 일반 파일이 아닌 경로는 열기 전에 거절한다. hash를 32 KiB씩 읽으며 취소를 확인한다. PATH 검색·shell·설치·자동 재시도·fallback은 없다. 이 검사는 신뢰된 설치 디렉터리를 전제로 하며 파일 확인과 실행 사이의 외부 교체나 OS 파일 I/O 지연을 sandbox처럼 통제하지 않는다.

한 공유 runner 포인터는 실행 1개·대기 0개를 허용한다. 포화 시 `BUSY`다. 서로 다른 runner를 만들면 별도 slot이므로 프로세스 전체 제한이라고 주장하지 않는다. 자식은 작업 전용 빈 cwd와 명시적인 환경을 받는다. Unix 환경은 비어 있고 Windows는 OS 실행에 필요한 `SystemRoot`만 전달한다. HOME·PATH·프로젝트·DB/API 설정과 extra file descriptor는 상속하지 않는다. Windows 실제 실행 검증은 아직 없다.

정상 흐름은 요청 작성 → 응답 검증 → stdin 닫기 → stdout trailing/EOF·stderr EOF·정상 exit 확인 → 결과 반환이다. host는 request 뒤 stdin을 열어 둔다. 수동 pipe의 자식 쪽 끝은 Start 성공·실패 모두 닫는다. request writer와 stdout reader 및 stderr drainer를 함께 실행하고 `Wait` 소유자는 하나만 둔다. stderr는 64 KiB까지만 보관하며 이후도 drain하고 truncation을 표시한다. payload를 자동 로그하지 않는다. 유효한 frame 뒤 nonzero exit나 trailing byte가 있으면 실패한다.

취소와 deadline은 독립 watcher가 pipe를 닫고 직계 자식을 kill한다. 응답 validator는 동기적으로 실행하며 `DecodeResponseContext`가 UTF-8·escape prescan, 4 KiB decoder read, token·배열 변환 사이에서 context를 확인한다. 기존 `DecodeResponse`는 Background wrapper다. domain의 최대 450,000 pair 결과 검사는 context 전후 확인을 하는 유한 단계로 유지한다. 그 단계와 OS scheduling·syscall은 hard real-time 취소를 보장하지 않는다. 결과 반환 직전 취소를 다시 확인하며 늦은 결과를 버린다.

host wall deadline은 부모 잔여 시간과 30초 중 작은 값이다. 정리는 요청 deadline과 독립적인 2초 안에서 모든 I/O owner와 실제 `Wait` 결과를 확인한다. 확인하지 못하면 PID·단계·남은 owner와 cwd 경로를 반환하고 runner를 영구 격리한다. 미확인 cwd는 제거하지 않는다. typed Counter도 이 근거를 구조화한 `Failure` 오류로 전달한다. 취소 오류는 고정 code와 context cause를 유지한다. kill 성공이나 WaitDelay만으로 회수 완료로 표시하지 않는다. 늦은 Wait는 기존 소유자가 계속 담당한다. 정상적으로 확인한 nonzero 종료는 일반 실패이며 격리 사유가 아니다.

### EOF의 관측 순서와 엔진 watchdog

Rust entrypoint만 stdio·thread·time과 fatal exit를 사용한다. 순수 library는 파일·네트워크·환경·프로세스를 사용하지 않는다. `Computing → Writing → Flushed → Closed` 상태와 tail-reader 관측을 mutex로 동기화한다. Computing 중 관측한 EOF는 취소·nonzero 종료다. 어떤 상태든 추가 byte는 fatal이다. Writing 중 EOF는 pending으로 두고 실제 writer 완료 또는 기존 30초 전체 수명 watchdog을 기다린다. writer가 성공한 뒤 pending EOF를 관측하면 정상 close다. 출력이 막혀 완료되지 않으면 watchdog이 nonzero exit한다. stdout 전체 쓰기를 mutex 안에서 기다리지 않는다.

이 규칙은 동기화된 관측 순서다. EOF의 물리적 도착 시각과 마지막 write 완료 통지의 scheduling 순서를 portable blocking stdio만으로 완전히 구별할 수 없다. 따라서 Writing 중 EOF 뒤 쓰기가 완성되는 경우는 정상 close로 수렴할 수 있다. 별도 ACK나 짧은 grace timeout은 추가하지 않는다. host가 취소하면 즉시 kill하므로 그 결과는 게시되지 않는다. 정상 종료는 소유 thread를 join한다. fatal I/O·panic·watchdog은 stateless engine의 `process::exit`로 종료하므로 thread join과 구분하고 OS exit/reap을 검증한다.

### 잘못된 payload의 오류 응답

엔진은 원본 envelope의 다섯 필수 key를 먼저 검사하고, 한 번 읽은 payload 원문을 따로 엄격 검증한다. 중복 key를 허용하는 JSON 재파싱으로 requestId를 추출하지 않는다. 검증한 ID·digest가 있으면 payload의 잘못된 숫자·중복 key·도메인 값·digest에 bounded 오류 frame을 반환한다. 해석할 수 없는 envelope·ID·digest에는 frame 없이 nonzero exit한다. protocol과 operation이 문자열인지를 먼저 검사한다. 지원하지 않는 문자열 값에는 검증한 correlation이 있을 때 `UNSUPPORTED_VERSION`과 서버의 고정 v1 protocol/operation을 반환한다. 임의 버전 원문을 되풀이하지 않는다. payload의 원문 숫자·중복 key 오류는 잘못된 버전이나 ID보다 먼저 `INVALID_INPUT`으로 유지한다. JSON 문법과 원문 숫자는 유효하지만 payload의 값 형태만 잘못된 경우에는 기존 버전 검사 순서를 유지한다. G2a `decode_request`의 오류 code는 유지한다. `fixtures/cases.json`의 `processRequests`는 버전·ID·원문/형태 오류의 교차 사례에 오류 code와 frame 유무를 고정하며 양 언어 corpus와 실제 binary 검사가 공유한다.

### 실제 통합 검사

```sh
cargo build --locked --manifest-path runtime/rust/Cargo.toml -p ariadne-compute --bin ariadne-compute
# 작업 전용 CARGO_TARGET_DIR을 지정한 뒤 절대 경로로 전달한다.
export ARIADNE_COMPUTE_TEST_BINARY="$CARGO_TARGET_DIR/debug/ariadne-compute"
(cd runtime/go && go test -count=1 -race ./... && go vet ./... && go run ./cmd/check-architecture --root ../..)
cargo test --locked --manifest-path runtime/rust/Cargo.toml -p ariadne-compute
```

실행 파일과 공통 fixture가 Go module 바깥에 있으므로 실제 통합 재검증에는 `-count=1`로 test cache를 비활성화한다. Go의 actual integration은 환경 변수에 실행 파일이 없으면 skip하므로 그 실행만으로 통합 통과를 주장하면 안 된다. `.github/workflows/native.yml`의 `compute-process` job은 두 언어를 함께 빌드하고 명시 경로를 설정해 실제 비교를 실행한다. Rust process tests는 즉시 close·추가 byte·부모 강제 종료·backpressure EOF와 watchdog을 실제 자식으로 검사한다. Go transport fault tests는 별도로 컴파일된 test helper를 사용하며 Rust 계산 동등성의 증거로 대체하지 않는다.
