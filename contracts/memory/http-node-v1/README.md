# Memory HTTP 인증 gate Node 기준 계약

기존 Node Memory HTTP 서버가 요청을 도구 실행기에 넘기기 전에 하는 인증·조직·scope 검사와 응답 형식을 고정한다. Go 이식은 같은 요청에 같은 상태 코드, `Content-Type`, `WWW-Authenticate`, 본문, 실행기 입력을 내야 한다. Go 구현은 `runtime/go/internal/memory/adapters/httpapi`에 있다. 이 fixture는 도구 실행, 저장소 수준 조직 격리, MCP 프로토콜 처리, rate limit의 근거가 아니다.

## 실행

Node **24.22.2**에서 `packages/memory`의 고정 의존성을 설치한 뒤 실행한다. 생성기는 실제 `createOperatorServer`를 `127.0.0.1`의 임시 포트에 띄우고 raw socket으로 요청을 보낸다. 도구 registry는 받은 도구 이름, `organizationId`, `dryRun`, 그리고 대소문자를 무시하면 이 둘과 같은 입력 키 목록(`gate_keys`)을 돌려주는 stub이다. 외부 호출은 없다.

```sh
(cd packages/memory && npx --no-install tsx scripts/http-contract-goldens.ts --check)
(cd runtime/go && go test -race ./internal/memory/...)
```

옵션을 생략하거나 `--check`를 주면 파일을 쓰지 않는다. 원본 계약 변경을 검토했을 때만 `--write`로 `expected.json`을 갱신한다. 생성기는 `MEMORY_`, `MCP_`, `LEGACY_`, `RATE_LIMIT`로 시작하는 환경변수를 지운 뒤 서버를 불러온다.

## 파일

| 파일 | 의미 |
| --- | --- |
| `cases.json` | 시나리오별 서버 설정(정적 토큰, OAuth 검증 결과 stub, 보호 자원 환경변수, 루프백 설정)과 요청 목록. 헤더 값은 latin1로 보낸다 |
| `expected.json` | Node 서버의 응답. MCP gate를 통과해야 하는 요청은 통과 여부만 기록한다 |

## 고정하는 동작

- 검사 순서: 보호 자원 메타데이터 GET → 정확히 `/mcp`인 요청의 MCP gate → 인증 → 경로·메서드 → 본문 → 조직 → scope → 실행.
- 메타데이터: 인증 없이 응답하는 것은 GET뿐이다. 경로 비교는 query를 무시하고 dot segment를 해석한다. 다른 메서드나 다른 접미어는 일반 경로처럼 인증을 거친다. OAuth 설정이 없으면 404다.
- 인증 실패: 401 envelope. `WWW-Authenticate`는 `/v1/`로 시작하는 경로에만 붙는다. `Authorization`이 여러 개면 첫 값을 쓴다. latin1 NBSP도 trim한다.
- 경로: `req.url` 전체가 정확히 일치해야 한다. query가 붙은 `/mcp?x`는 REST 경로로 처리되어 404다.
- 본문: 1,000,000바이트까지 받고 넘으면 400이다. 공백뿐인 본문, BOM으로 시작하는 본문, 잘못된 JSON은 `invalid JSON body`다. 빈 본문, 배열, `null`은 `request body must be a JSON object`다.
- 조직: 토큰 바인딩, `x-organization-id` 헤더, 본문 `organizationId` 순서다. 헤더가 두 번 오면 400이고, 쉼표가 들어간 값 하나는 그대로 조직 하나다. 형식 오류(400)가 바인딩 충돌(403)보다 먼저다.
- 실행기 입력: Node 도구 스키마는 모르는 키를 지운다. 그래서 `organizationid`처럼 대소문자만 다른 키는 실행기에 닿지 않는다. `compact_memory`의 `dryRun`이 boolean이 아니거나, 조직을 정한 뒤에도 `reindex_memory`에 `organizationId`가 없으면 scope 검사 뒤 400 `invalid request body for <tool>: <field>: ...`이다.
- scope: OAuth 토큰만 검사한다. 거절은 403 `insufficient_scope`와 필요한 scope를 담은 `WWW-Authenticate`다. `compact_memory`는 `dryRun: false`일 때만 admin이 필요하다.
- MCP gate: 메서드(405) → 루프백 설정일 때만 Host 허용 목록 → Origin → 인증(401, JSON-RPC `-32001`) 순서다. Host와 Origin의 hostname은 WHATWG `new URL()`로 읽는다. 포트가 65535를 넘거나, scheme이 없거나, IPv6 zone이 있거나, 괄호 안이 IPv6가 아니면 거절한다. host를 소문자로 바꾸는 것은 special scheme뿐이다.
- 인증이 꺼진 서버는 `Authorization`을 무시하고 헤더나 본문의 조직을 그대로 넘긴다.

## 범위와 알려진 차이

- Go 테스트는 `httptest`로 handler를 직접 호출한다. Node처럼 socket을 거치지 않으므로 HTTP/1.0 요청과 Host 생략은 `Request.Host`를 비워 재현한다.
- 보호 자원 메타데이터 문서와 JWT 검증은 `oauth-node-v1` 계약이 고정한다. 여기서는 OAuth 검증 결과를 stub으로 넣는다.
- 실행기 입력: Go gate는 권한 판단에 쓰는 필드만 Node 스키마와 같게 검사한다. 대소문자만 다른 `organizationId`·`dryRun` 키를 지우고, `compact_memory`의 `dryRun`은 boolean만, `reindex_memory`의 `organizationId`는 비어 있지 않고 공백뿐이 아닌 필수 문자열로 받는다. `encoding/json`은 struct 필드를 대소문자 구분 없이 묶으므로, 변형 키가 남으면 gate가 보지 않은 값이 Go 도구에 들어간다. 다른 스키마 규칙은 실행기가 맡는다. 예를 들어 필수 `projectKey`가 있다. 여러 필드가 함께 틀리면 Node는 스키마 순서상 첫 오류를 보고하고, Go gate는 자기 필드의 오류를 보고할 수 있다.
- Origin·Host: Go는 `net/url`이 WHATWG와 같게 읽는 형식만 받는다. `file:` Origin, 퍼센트 인코딩·IDNA host, 축약 IPv4, `//`가 없는 special scheme은 Node가 받아들여도 거절한다. Host 거절 메시지는 Node와 다를 수 있지만 상태 코드는 같은 403이다. 예를 들어 `localhost]:80`은 Node에서 `Invalid Host header: localhost]:80`, Go에서 `Invalid Host: localhost]`다. IPv4 대응 IPv6 주소도 표기가 다르다.

## 조립 전제

Go handler는 gate만 옮겼다. 진입점을 조립할 때 다음을 지켜야 Node와 같은 경계가 된다.

- `NewHandler`는 시작 검사를 하지 않는다. Node `startOperatorServer`처럼 진입점이 `domain.CheckBindAuthentication`을 먼저 호출해야 한다.
- 정적 토큰과 OAuth 검증기가 모두 없는 `Authenticator`는 서버를 연다. Node는 이때 `auth.disabled` 경고를 남기지만 Go handler는 남기지 않는다.
- 루프백 주소에 바인딩하면 진입점이 `Options.MCPAllowedHosts = LoopbackMCPHosts`를 넘겨야 한다. 빠뜨리면 Node의 DNS rebinding 방어가 사라진다.
- `/mcp` 뒤의 MCP adapter는 Node MCP SDK처럼 도구 스키마를 먼저 적용한 뒤, 도구 호출마다 `domain.AuthorizeToolCall`을 호출하고 그 반환 입력을 도구에 넘겨야 한다. gate는 인증만 하고 scope와 조직은 검사하지 않는다.
- Node는 registry 단위로 scope와 조직을 검사하므로 MCP resource와 prompt가 부르는 도구도 같은 검사를 거친다. Go adapter도 `tools/call`뿐 아니라 resource와 prompt 경로를 같은 검사로 감싸야 한다.
- `/healthz`, `/readyz`, `/metrics`, rate limit은 옮기지 않았다. 이 경로는 Go에서 인증을 거친다.
