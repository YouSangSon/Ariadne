# Memory HTTP 인증 gate Node 기준 계약

기존 Node Memory HTTP 서버가 요청을 도구 실행기에 넘기기 전에 하는 인증·조직·scope 검사와 응답 형식을 고정한다. Go 이식은 같은 요청에 같은 상태 코드, `Content-Type`, `WWW-Authenticate`, 본문, 실행기 입력을 내야 한다. Go 구현은 `runtime/go/internal/memory/adapters/httpapi`에 있다. 이 fixture는 도구 실행, 저장소 수준 조직 격리, MCP 프로토콜 처리, rate limit의 근거가 아니다.

## 실행

Node **24.22.2**에서 `packages/memory`의 고정 의존성을 설치한 뒤 실행한다. 생성기는 실제 `createOperatorServer`를 `127.0.0.1`의 임시 포트에 띄우고 raw socket으로 요청을 보낸다. 도구 registry는 받은 도구 이름과 `organizationId`만 돌려주는 stub이다. 외부 호출은 없다.

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
- scope: OAuth 토큰만 검사한다. 거절은 403 `insufficient_scope`와 필요한 scope를 담은 `WWW-Authenticate`다. `compact_memory`는 `dryRun: false`일 때만 admin이 필요하다.
- MCP gate: 메서드(405) → 루프백 설정일 때만 Host 허용 목록 → Origin → 인증(401, JSON-RPC `-32001`) 순서다.
- 인증이 꺼진 서버는 `Authorization`을 무시하고 헤더나 본문의 조직을 그대로 넘긴다.

## 범위와 알려진 차이

- Go 테스트는 `httptest`로 handler를 직접 호출한다. Node처럼 socket을 거치지 않으므로 HTTP/1.0 요청과 Host 생략은 `Request.Host`를 비워 재현한다.
- 보호 자원 메타데이터 문서와 JWT 검증은 `oauth-node-v1` 계약이 고정한다. 여기서는 OAuth 검증 결과를 stub으로 넣는다.
