# 숫자 기반 co-change 계산 계약 v1

이 계약은 신뢰된 Code 계산의 JSON 값과 순수 라이브러리만 정의한다. G2a에는 실행 파일, frame, subprocess, EOF·취소·watchdog, DB 게시나 공개 CLI가 없다. 기존 TypeScript 제품은 이 라이브러리를 호출하지 않는다. 프로세스 통신은 [목표 설계 §5–6](../../../docs/go-rust-runtime-design.ko.md)에 따른 G2b 후속 범위다.

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
| 문자열 인코딩·문서 경계 | 유효 UTF-8, JSON 값 하나, 뒤에는 공백만 허용 |
| 숫자 원문 | `0\|[1-9][0-9]*`에 맞고 u32 이내. -0·음수·소수·지수·overflow 거절 |
| object key | 대소문자 구분, escaped key를 해석한 뒤 중복 거절, 모든 계층의 unknown/missing/null 거절 |
| 입력 관계 | commit ID 범위·오름차순·중복 없음 |
| 결과 관계 | 빈도 길이·상한, pair 순서·ID·count·ordinal 순열 |
| canonical hash | payload key 순서 `fileCount,commits`, compact UTF-8 decimal JSON, 빈 배열 `[]`, null 없음 |

원문 envelope의 공백과 payload key 순서는 달라도 된다. canonical payload로 digest를 재계산한다. tiny의 bytes는 `{"fileCount":3,"commits":[[0,1],[1,2]]}`이고 SHA-256은 `73c33205d9b30fdfdf31e08236aaf51c309f31ebab0c6e98910f013f94e732d6`이다. Python 표준 hashlib로 별도 계산했고 Go·Rust·TS가 같은 값을 검사한다.

요청의 잘못된 타입·JSON·digest·필드·도메인 값은 `INVALID_INPUT`, 문자열인 버전/operation 불일치는 `UNSUPPORTED_VERSION`, 크기/개수 상한 초과는 `LIMIT_EXCEEDED`다. 응답의 잘못된 값·JSON·버전·상관관계는 `PROTOCOL_ERROR`, 응답 크기/개수 상한 초과는 `LIMIT_EXCEEDED`다. 기대 요청 자체가 잘못되면 요청 검증 오류를 반환한다. 유효한 `status:error`의 code는 원문 enum을 유지한다. 파싱 오류의 원문 메시지는 반환하지 않는다.

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

TypeScript snapshot은 Node 24.22.2·ICU 78.3·en-US 기준이다. npm의 로컬 11.9.0과 CI 11.19.1 차이는 npm 실행 환경의 차이이며 컴파일러나 fixture 동등성의 근거로 합치지 않는다. Go locale 구현·SQLite 게시·incremental proven confidence·savepoint는 G4 범위다. 이 오프라인 비교를 그 기능의 완료 근거로 쓰지 않는다. Rust 실행·취소·EOF 및 성능 이득도 검증하지 않는다.
