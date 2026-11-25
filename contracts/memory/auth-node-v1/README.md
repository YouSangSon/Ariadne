# Memory 인증·조직 Node 기준 계약

기존 Node Memory의 HTTP/MCP 인증과 조직 경계 정책을 고정한다. Go 이식은 같은 입력에서 이 결과와 일치해야 한다. Go 구현은 `runtime/go/internal/memory`에 있다. 이 fixture는 Go Memory 서버, 저장소 수준 조직 격리, MCP 프로토콜 처리를 구현했다는 근거가 아니다.

## 실행

Node **24.22.2**에서 `packages/memory`의 고정 의존성을 설치한 뒤 실행한다. 외부 호출은 없다.

```sh
(cd packages/memory && npx --no-install tsx scripts/auth-contract-goldens.ts --check)
(cd runtime/go && go test -race ./internal/memory/...)
```

옵션을 생략하거나 `--check`를 주면 파일을 쓰지 않는다. 원본 계약 변경을 검토했을 때만 `--write`로 `expected.json`을 갱신한다. Go 출력으로 입력이나 기대값을 만들지 않는다.

## 파일

| 파일 또는 필드 | 의미 |
| --- | --- |
| `cases.json` | 고유 `id`와 `op`를 가진 합성 입력 |
| `expected.json` | 실제 Node 원본 함수의 반환값과 오류 메시지 |
| `source_manifest` | Node 버전, 원본 소스와 생성기 및 입력의 SHA-256. 하나라도 바뀌면 `--check`가 실패한다 |
| `challenge_metadata_url` | scope 거절 헤더 사례가 쓰는 보호 자원 메타데이터 URL |

## 사례 종류

| op | Node 원본 | 고정하는 동작 |
| --- | --- | --- |
| `static_tokens` | `loadBearerTokens` | `MEMORY_API_TOKENS`의 `token` 또는 `token:org`. 빈 항목 검사가 항목별 검사보다 먼저다. 콜론은 하나까지. JS trim은 ES 공백을 지우고 NEL(U+0085)은 남긴다 |
| `authenticate` | `authenticateBearer` | 정확한 `Bearer ` 접두어, 정적 토큰 우선, 첫 일치 반환, OAuth 검증기에는 trim한 토큰만 전달 |
| `resolve_organization` | `resolveOrganizationId` | 토큰 바인딩 → `x-organization-id` 헤더 → 본문 순서. 헤더 중복과 형식 오류가 바인딩 충돌보다 먼저다 |
| `scope_kind`, `check_scopes` | `requiredScopeKindForTool`, `checkOAuthScopes` | 도구별 read·write·admin. `compact_memory`는 `dryRun === false`일 때만 admin. 정적 토큰은 scope 검사를 건너뛴다 |
| `mcp_context`, `mcp_service` | `createMcpToolAuthorizer`, `withAuthenticatedRegistry` | scope 검사 뒤 조직 불일치 검사. 바인딩된 토큰은 도구 입력의 `organizationId`를 바인딩 값으로 바꾼다 |
| `www_authenticate` | `buildOAuthWwwAuthenticateHeader` | `resource_metadata`와 `scope`의 따옴표·역슬래시 escape |
| `safe_auth_config` | `assertSafeAuthConfig`, `isLoopbackHost` | 인증 없이 루프백이 아닌 주소에 바인딩하면 시작 거절 |
| `assert_organization` | `assertOrganizationId` | 조직이 필요한 읽기에서 조직이 없으면 거절. `LEGACY_ANONYMOUS_SEARCH`만 예외 |

## 범위와 알려진 차이

- Go 문자열은 UTF-8이다. JSON 본문의 짝 없는 surrogate는 `encoding/json`이 U+FFFD로 바꾸고 Node는 원문을 유지한다. 이 입력은 사례에 넣지 않았다.
- 서비스 도구 스키마는 `organizationId`를 문자열로만 받는다. 스키마 검증 전에는 도달하지 않는 비문자열 입력은 `mcp_context`에서만 고정한다.
- Node `normalizeUnresolvedOrganizationId`는 REST 경로에서 도달하지 않으므로 이식하지 않았다.
- Node가 OAuth 검증 결과의 형태를 런타임에 검사하는 부분은 Go 타입이 대신한다.
- MCP 도구 호출: Node MCP SDK는 도구 스키마를 먼저 적용해 모르는 키를 지우고 boolean이 아닌 `dryRun`을 거절한다. Go `AuthorizeToolCall`은 대소문자만 다른 `organizationId`·`dryRun` 키를 지우고, boolean이 아닌 `compact_memory` `dryRun`을 scope 검사 전에 거절한다. `mcp_context`·`mcp_service` 사례는 스키마를 거치지 않은 Node 함수의 결과라 이 동작을 담지 않는다. 이 동작은 Go 단위 테스트가 고정한다.
- OAuth JWT 검증, 보호 자원 설정 파싱, HTTP 응답 형식과 검사 순서는 별도 계약이다.
