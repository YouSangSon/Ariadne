# Node 온톨로지 이식용 골든

이 파일들은 G1 이식에 앞서 **기존 Node 원본의 선택된 동작**을 보존한다.
공개 제품 API나 Go 호환성 보증이 아니다. 기존 domain/application/scrub은 변경하지 않는다.
파일 어댑터의 symlink·1 MiB·UTF-8 보호는 `tests/ontology.test.mjs`가 계속 검증한다.
이 코퍼스는 파일 시스템 보안을 다시 검증하지 않는다.

## 실행과 갱신

Node **24.22.2 / ICU 78.3 / Unicode 17.0**에서 저장소 루트 기준으로 실행한다.
도구 버전 설정은 이 fixture가 소유하지 않는다. 다른 설치 버전이 기본이면 해당 Node의
정확한 실행 경로나 PATH를 선택한다. 외부 서비스·패키지 설치·모델 호출은 필요 없다.

```sh
node scripts/ontology-node-goldens.mjs --check
node --test tests/ontology-node-contracts.test.mjs tests/ontology.test.mjs tests/module-boundaries.test.mjs
node scripts/verify.mjs --modules ontology
```

옵션 생략과 `--check`는 파일을 쓰지 않는다. 의도한 계약 변경을 원본과 비교·검토한 뒤에만
`node scripts/ontology-node-goldens.mjs --write`로 `expected.json`을 갱신한다.
원본 3개 파일의 SHA와 런타임 profile을 코드에서 고정하므로 `--write`도 원본이나
런타임이 달라지면 실패한다. 변경을 승인할 때는 그 고정값과 출력 diff를 함께 검토해야 한다.
입력과 oracle 자체의 SHA도 기대 결과에 들어가며, 검사기는 어느 한쪽의 차이도 거절한다.
source/fixture 파일 전체의 보관 SHA는 작업별 private 검증 기록에 따로 남긴다.

## 파일과 값의 의미

| 파일 / 필드 | 의미 |
| --- | --- |
| `cases.json` | `fixture_version: 1`과 고유 `id`를 가진 선택 사례 배열 |
| `document_json` | JSON.parse에 전달할 실제 작성 JSON 문자열. 중복키·숫자 토큰·작성 필드 순서를 보존한다 |
| `sources` | 경로를 UTF-8 텍스트에 대응한 오프라인 출처 포트. 읽을 때 실제 SHA-256을 계산한다 |
| `searches` | 입력 `query`와 선택 `limit`. limit 생략은 기존 기본값을 사용한다 |
| `expected.json` | 실제 원본 `validateDefinition`, `loadOntology`, `inspectOntology`, `searchOntology`의 literal 관측 |
| `provenance` | Node/ICU/Unicode와 원본 import closure, 입력 파일, oracle 파일의 SHA-256 |
| `validation` | 실제 domain 검증 결과 또는 오류 |
| `document_reads`, `source_reads` | load가 문서를 읽은 횟수와 출처를 읽은 순서. 배열 길이가 출처 읽기 횟수다 |
| `fingerprints` | 실제 application의 hash 포트에 전달한 문자열의 **정확한 UTF-8 hex**와 그 bytes의 SHA-256 |
| `inspect`, `searches`, `load_error` | 원본 출력 또는 오류. search 오류 하나는 다른 query 관측을 막지 않는다 |

fingerprint는 원본이 `JSON.stringify`한 고정 필드 순서의 bytes다. 정규화 전 작성 문자열과
정렬한 source hash를 담으며 `reviewed_digest`는 제외한다. UTF-8 hex를 직접 비교해야 한다.
다른 언어에서 파싱 후 JSON을 재직렬화하면 `<>&`, U+2028/U+2029, escape와 필드 순서가
바뀔 수 있다. `expected.json` 자체의 직렬화는 fingerprint bytes의 대체물이 아니다.

JSON 문자열의 lone surrogate는 `\ud800` 같은 escape로 보존된다. 소비자는 이를
Unicode scalar 문자열로 강제 변환하거나 U+FFFD로 대체하면 안 된다. 이름/검색 길이와
부분 문자열은 JS의 UTF-16 code unit 기준이다. 예를 들어 astral 문자 하나의 앞/뒤 surrogate만
검색해도 그 문자를 포함한 이름이 일치한다. 골든의 query/name 값과 fingerprint hex가 이를 보존한다.

문서 포트는 raw JSON에 `JSON.parse`를 적용한다. 파싱 실패는 원문이 진단에 섞일 수 있어
`{ "name": "SyntaxError" }`만 기록한다. 이는 오프라인 oracle의 진단 처리이며 파일/CLI의
`Invalid ontology JSON` 오류 계약을 대체하지 않는다. 정상 파싱 후 domain 오류는 실제 name/message를 기록한다.

## 선택 사례의 경계

36개 사례는 다음 구별되는 결과를 고정한다. 전체 Unicode나 모든 schema 조합의 전수 검증이 아니다.

- 출처 경로 중복 제거·UTF-16 정렬·원본 bytes의 hash, 검토 미실시/current/정의 변경 stale/출처 변경 stale
- exact/label substring/description 순위와 ID 동률 순서, 잘라내기 전 모호성, 선택된 용어의 관계 경계
- 이름 200/201 및 query 256/257 UTF-16 경계의 astral 문자, lone high/low surrogate와 astral half-query
- U+0130 full lowercase와 31개 case-ignorable mark를 넘는 Greek sigma 문맥
- Cased(대소문자 속성)와 Case_Ignorable(대소문자 문맥에서 건너뛰는 속성)에 동시에 속하는 U+0345 앞/뒤의 sigma. 이후 cased 문자 유무와 문맥을 끊는 emoji/lone surrogate를 literal 소문자 query로 비교해 이름과 query 정규화의 동반 오류를 드러낸다
- NFKC의 분해/합성·전각·한글 자모, 31개 nonstarter와 작성된 CGJ의 차이
- JS trim의 BOM U+FEFF와 NEL U+0085, 공백/타입/limit 오류
- `<>&`, U+2028/U+2029, 따옴표와 역슬래시를 포함한 raw fingerprint
- JSON 중복키 last-wins와 `schema_version: 1e0`/`1.000` 허용, 파싱 실패의 원문 비노출
- strict field·ID·중복·관계·경로·review digest·32개 unique source 제한과 오류 시 출처 읽기 0회

G2의 duplicate-key/lone-surrogate/정수 토큰 거절 정책을 여기로 가져오지 않는다.
Go 소비자·수동 Unicode normalizer·Node wrapper 전환은 후속 G1 작업이며 이 단위에는 없다.
