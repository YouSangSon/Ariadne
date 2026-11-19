# Requirements Node 기준 계약

기존 Node Requirements의 계약 해시와 인메모리 포트 동작을 보존한다. Go 구현·native 파일/Git 어댑터·CLI·기본 실행기 전환·자동 승인 실행은 이 fixture의 완료 주장이 아니다.

## 실행

저장소 루트에서 실제 Node **24.22.2 / ICU 78.3 / Unicode 17.0**으로 실행한다. `.tool-versions`는 변경하지 않는다. 패키지 설치나 외부 호출은 필요 없다.

```sh
node scripts/requirements-node-goldens.mjs --check
node --test tests/requirements-node-contracts.test.mjs tests/loop-contract.test.mjs tests/module-boundaries.test.mjs
```

옵션 생략과 `--check`는 파일을 쓰지 않는다. 원본 계약 변경을 검토했을 때만 `--write`로 기대값을 갱신한다. `--write`도 고정 runtime과 source SHA를 검사한다. 고정값을 바꾸는 일은 원본 계약 변경 검토와 함께 다뤄야 한다. Go 출력으로 입력이나 기대값을 생성하면 안 된다.

## 원본과 파일

| 파일 또는 필드 | 의미 |
| --- | --- |
| `cases.json` | 고유 id와 operation을 가진 입력. YAML 원문은 JSON 문자열로 저장해 작성 공백·escape·UTF16을 보존 |
| `expected.json` | 실제 Node 원본 실행의 반환값·오류·호출 순서·정확한 hash bytes·고정 digest |
| `source_manifest` | runtime과 production import closure SHA. domain/application/Core requirement-fields가 실행 closure |
| `retained_reference_sha256` | files adapter와 기존 loop façade의 보존 SHA. 이 oracle이 native I/O를 실행한다는 의미는 아님 |
| `payload_manifest` | 입력·oracle 파일 SHA와 각 실제 contract payload digest. source manifest와 별도 소유 |
| `utf16_hex` | 해당 결과 문자열을 네 자리 소문자 hex code unit으로 표현. object key는 원래 이름을 유지 |
| `events` | 포트에 진입한 실제 순서. 실패한 호출도 기록하며 그 뒤 호출은 없어야 함 |
| `payloads[].utf8_hex` | `loadContract`가 hash 포트에 전달한 **실제 UTF8 bytes** |
| `updates[]` | `sourceState`가 Update에 넘긴 header 또는 raw bytes. 작은 값은 hex, 큰 값은 정확한 recipe |
| `original_port_error` | 주입한 오류 객체와 반환 오류의 identity가 같은지 관측 |

원본 closure는 `modules/requirements/{domain,application}.mjs`와 `core/domain/requirement-fields.mjs`다. 표준 Node crypto는 실제 SHA256을 계산한다. 파일 전체 보관 SHA와 실행 로그는 작업별 private handoff가 소유한다.

## 지원 입력과 생성 recipe

operation은 `contract`, `slug`, `files`, `state`다. `contract`는 같은 YAML과 req_id로 `parseContract` 및 port 기반 `loadContract`를 각각 실행한다. slug 입력은 문자열만 사용한다. source path와 kind는 문자열, mode는 integer 또는 null, content는 raw bytes다. 이 typed profile은 JS의 모든 임의 타입을 새 Go API에 요구하지 않는다.

`paths` 배열을 먼저 복사한다. `path_recipe`가 있으면 `prefix`(기본 `file-`) 뒤에 0부터 count-1을 `width`(기본 5) 자리 0 채운 숫자로 붙여 추가한다. 다음으로 duplicates개를 기존 배열의 `i % count` 위치에서 추가하고, excluded개의 `node_modules/generated-i`를 추가한다. `paths`에 선행 항목이 있는 사례에서는 duplicates를 사용하지 않는다.

10000개 output을 그대로 추적하지 않는다. recipe case의 기대값은 count, first/last 각 두 항목, **정렬 결과 각 path의 UTF16BE code-unit bytes와 0000 종결자를 이어 붙인 SHA256**이다. 이 recipe에는 NUL path가 없다. 원본 입력의 중복·제외 전 크기와 최종 제한을 구별한다.

`state.inputs[path]`는 kind, nullable mode와 `content_hex` 또는 `content_recipe`를 가진다. 큰 integer mode는 `mode_decimal` 문자열 recipe로 원래 int64 입력을 보존한다. Node oracle은 `Number(mode_decimal)`을, Go fixture는 `ParseInt(..., 64)`를 사용한다. header mode는 Node Number의 shortest-decimal 표기를 따른다. 예를 들어 정확한 integer 1000000000000000128도 JSON frame에는 1000000000000000100으로 들어간다. safe-integer 제한이나 mode masking을 추가하지 않는다. content recipe는 `{length, byte}`이며 그 byte를 정확히 length번 반복한다. 64MiB exact, 32MiB 두 파일의 exact 합계, 64MiB 뒤 한 byte 초과, 첫 파일부터 초과를 포함한다. 기록한 recipe와 length와 raw SHA 및 Node aggregate digest로 재현할 수 있다. 큰 tracked binary나 임시 파일은 만들지 않는다.

`fail`은 `readRequirement`, `hash`, `inspectGit`, `sourceHasher`, `readInput`, `update`, `digest` 중 해당 operation 포트를 실패시킨다. update의 `fail_at`은 header와 content를 모두 세는 0 기반 호출 index다. `fail_path`가 있으면 그 경로의 read만 실패한다. 포트는 event를 기록한 직후 동일 Error 객체를 던진다. 실패 update의 frame도 호출 입력으로 기록하지만 실제 crypto에는 전달하지 않는다.

## parser와 hash 계약

`parseContract`는 full YAML/schema validator가 아니다. slug → NUL/indent → top mappings → req_id → status → AC → scope 순서다. schema_version과 kind를 새로 검사하지 않는다. AC에서는 전체 field collection 뒤 id/statement/verification 순서로 scalar를 검사하고, invalid/duplicate ID → priority → passes를 검사한다. 첫 AC의 검증이 끝나야 다음 AC를 처리한다.

literal/folded/chomp, JSON double quote와 YAML single quote, 주석, 잘못된 continuation/indent 및 plain numeric 거절을 고정한다. reserved/numeric scalar의 대소문자는 ASCII만 접는다. Node의 `i` without `u` 규칙에 따라 `FALSE`와 `false`는 거절하지만 long-s를 쓴 `falſe`는 원문 그대로 허용한다. double quote의 JSON escape는 lone high/low surrogate를 허용한다. JS trim은 ES whitespace를 제거하지만 NEL U+0085는 남긴다. raw LS/PS/CR은 정규식의 줄 경계와 `.` 동작 때문에 escaped 문자열과 다른 결과를 낼 수 있다. literal raw와 escaped 사례를 둘 다 보관한다.

scope는 다음 순서의 **원문 FieldBlock 문자열 10개**다. 없는 필드는 빈 문자열이며 주석과 내부 CRLF 및 LS/PS를 유지한다. 직접 parser는 adapter의 BOM 제거·CRLF 변환을 수행하지 않는다. leading BOM이 어느 mapping 앞에 놓였는지에 따라 결과가 다를 수 있다.

1. requirement.user_intent
2. requirement.desired_outcome
3. requirement.confirmed_facts
4. requirement.assumptions
5. code_mapping.boundary_rules
6. audit.must_not_implement
7. verification.commands
8. verification.verify_gate_required
9. verification.verify_gate_reason
10. verification.escalate_after

load 순서는 slug → ReadRequirement → Parse → Hash다. payload는 고정 키 순서 `JSON.stringify({req_id,criteria,scope})`의 UTF8 bytes다. criteria 각 항목도 id/statement/verification 순서다. status/priority/passes/evidence/attempts는 hash에서 제외하지만 status/priority/passes의 검증을 생략하지 않는다. `<>&`, lone surrogate, astral, LS/PS의 escape와 UTF8을 표준 JSON 재직렬화와 혼동하지 않는다.

## 소스 선택과 포트 순서

`sourceFiles`는 UTF16 exact 중복 제거 → exact 제외 → UTF16 정렬 → 최종 10000 제한이다. `.git`/node_modules는 정확한 경로 component이고, `.harness/handoff` exact 및 prefix는 루트에서만 제외한다. selected REQ 한 경로만 선택적으로 제외한다. reqId를 검증하거나 경로를 Clean/casefold하지 않는다.

`sourceState`는 선택 slug → InspectGit → SourceFiles → SourceHasher factory 한 번 → 정렬한 파일마다 ReadInput 한 번 → 누적 raw content 길이 검사 → Update 두 번 → Digest다. header는 정확히 `JSON.stringify([path,kind,mode,content.length]) + '\n'`다. 그 뒤 raw bytes를 전달하고 빈 bytes도 Update한다. HEAD는 nullable 출처 정보이며 hash 입력이 아니다. kind/mode를 검증하거나 masking하지 않는다. 제한 초과 파일도 읽되 header/content Update를 호출하지 않는다.

callback의 값 복사 시점도 원본 계약이다. reqId는 SourceState 진입 시 읽고 HEAD는 InspectGit이 반환한 즉시 읽는다. InspectGit이 caller의 reqId를 바꾸거나 hasher factory가 반환 record의 HEAD를 바꿔도 이미 읽은 값은 유지한다. `mutations.inspect_req_id`와 `mutations.factory_head`가 이 관측을 재현한다. raw content Buffer는 원본처럼 Update에 직접 넘기며 포트 전체를 deep copy하지 않는다.

### Git 파일 읽기

Git 지문은 선택한 파일의 내용을 합해 64 MiB까지 처리한다. REQ 본문과 프로젝트 텍스트를 읽는 API는 파일당 1 MiB를 유지한다. 2026-11-19 [범위 결정](../../../.harness/reqs/git-fingerprint-stream.yaml)은 Git 입력에 적용하던 개별 1 MiB 제한을 대체한다.

파일 어댑터는 일반 파일을 한 번 열어 최대 64 KiB씩 읽는다. 헤더의 길이는 실제 내용 바이트 수다. 작은 입력은 첫 버퍼에서 길이를 알 수 있다. 큰 파일은 보고된 끝 위치를 확인하고 곧바로 해시한다. 파일이 보고한 길이를 신뢰할 수 없고 데이터가 버퍼보다 크면, 접근 권한 0600의 임시 파일을 열고 즉시 이름을 지운 뒤 실제 길이를 세면서 기록한다. 이 경우에만 최대 남은 입력 예산만큼 임시 디스크 공간이 필요하다. 모든 경로에서 디스크립터를 닫는다.

일반 파일은 바이너리를 그대로 포함한다. 최종 심볼릭 링크는 링크 대상 문자열을 바이트로 인코딩하고 누락 파일은 빈 내용을 사용한다. 파일별 mode와 정렬 순서, 선택 제외 규칙 및 직렬화는 기존 규칙을 따른다. 합계 초과, 읽기 오류, 관측한 변경 또는 전달 길이 불일치가 발생하면 성공 지문을 반환하지 않는다. 파일마다 확인하므로 작업공간 전체의 한 시점 스냅샷은 보장하지 않는다.

## 이식과 남은 검증

Go는 Requirements private immutable lossless Text와 최소 JSON-string decoder를 소유한다. 공유 범위는 기존 Core FieldBlock 정책뿐이다. Context의 partial parser를 strict parser로 바꾸거나 general Text/JSON 플랫폼을 추가하지 않는다. Node contract tests는 baseline 보존이며 Go의 failing-before 증거가 아니다. Go 단계에서는 compile 가능한 stub의 behavior RED를 먼저 확보하고 최종 통합 후 Go race/vet/AST와 root source gate를 실행한다.
