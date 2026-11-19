# Context Node v1 계약

기존 Node Context의 순수 domain/application/skills, Core의 부분 REQ 필드 추출,
예산 프리셋을 실제 호출한 결과다. production Node는 변경하지 않는다.

- 고정 실행 환경: Node 24.22.2 / ICU 78.3 / Unicode 17.0.
- `cases.json`은 입력, `expected.json`은 실제 Node 관측이다.
- 모든 손실 가능한 본문 입력과 출력은 UTF-16BE hex다. 한 코드 단위는 네 자리다.
  짝이 없는 surrogate도 보존한다. pack의 `pack_utf16_units`는 실제 `pack.length`,
  `pack_utf8_hex`는 실제 `Buffer.from(pack, 'utf8')`의 replacement 출력이다.
- `provenance`는 전체 순수 Node 소스 closure와 입력·오라클 SHA-256을 기록한다.
  기대값은 `node scripts/context-node-goldens.mjs --write`로만 생성한다.
  Go 결과나 사람이 쓴 값으로 기대값을 바꾸지 않는다.
- 검사: `node scripts/context-node-goldens.mjs --check`와
  `node --test tests/context-node-contracts.test.mjs`.
  Go는 `runtime/go`에서 `go test ./internal/context/... ./internal/core/domain/requirementfields`.

272개 사례는 handoff heading 순서·중복·legacy, LF 분리와 CR/CRLF/LS/PS 정규식
경계, ECMAScript 공백 전체 목록과 NEL·U+180E의 차이, 선택 경로의 부분 mapping,
별개의 REQ/skill slug, quoted scalar와 escaped/literal surrogate를 포함한다.
이식 전 최초 173개 사례에서 컴파일되는 미구현 API의 동작 RED를 확인했다.
후속 99개는 공백·JSON escape·catalog UTF-16 char count를 보강한 특성화다.

전체 필수 본문과 notices의 상한 ±1, 모든 프리셋, optional 후보 창과 역순 결정,
astral pair를 가르는 snippet, omitted 9→10 이후 최종 LIFO 제거를 고정한다.
애플리케이션은 fake store의 정확한 read trace와 원본 오류를 기록한다.
모든 selection을 파싱한 뒤 중복을 검사하고, 각 skill 읽기 직후 SHA를 비교한다.
자동 REQ는 두 번째 active에서 중단하지 않고 뒤의 잘못된 REQ 오류까지 보존한다.

포트는 이미 scrub한 레코드를 제공한다. 순수 애플리케이션은 SHA를 다시 계산하거나
본문을 다시 scrub하지 않는다. catalog는 Content가 없는 typed projection이며
목록 순서와 중복·개수 및 전달된 Chars를 보존한다. 실제 100개 상한·정렬·파일 보안,
raw bytes SHA와 scrub은 후속 파일 어댑터 책임이다.

이 사례는 선택된 실제 문자열·부분 parser 계약을 증명한다. 모든 임의 Unicode,
formal YAML, 범용 JS coercion, 파일·CLI·기본 전환·Linux·성능 동등성을 증명하지 않는다.
