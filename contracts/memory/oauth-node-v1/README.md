# Memory OAuth Node 기준 계약

기존 Node Memory의 OAuth 보호 자원 설정과 JWT 접근 토큰 검증을 고정한다. 검증기는 `jose` 6.2.13이 판정한다. Go 이식은 같은 설정, 같은 토큰, 같은 HTTP 응답, 같은 시각에서 같은 결과를 내야 한다. 실제 인가 서버와의 통합 시험이나 운영 키 회전의 근거는 아니다.

## 실행

Node **24.22.2**에서 `packages/memory`의 고정 의존성을 설치한 뒤 실행한다. 생성기는 네트워크를 쓰지 않는다. 모든 HTTP 응답은 `cases.json`의 fixture가 대신한다.

```sh
(cd packages/memory && npx --no-install tsx scripts/oauth-contract-goldens.ts --check)
```

| 옵션 | 동작 |
| --- | --- |
| 생략 또는 `--check` | 저장된 `material.json`으로 다시 실행해 `expected.json`과 비교한다. 파일을 쓰지 않는다 |
| `--write` | 원본 변경을 검토한 뒤 `expected.json`만 갱신한다 |
| `--write-material` | 테스트 키와 서명 토큰을 새로 만든 뒤 `expected.json`도 갱신한다. 키가 바뀌므로 diff가 커진다 |

## 파일

| 파일 | 의미 |
| --- | --- |
| `cases.json` | 설정 환경변수, 키 종류, JWKS 문서 구성, 토큰 서명 사양, URL별 HTTP 응답 순서, 시각 이동 |
| `material.json` | 생성한 공개 JWK, 서명한 테스트 토큰, 비공개 키 거절 사례용 테스트 전용 비공개 JWK 하나 |
| `expected.json` | Node 결과. 설정은 보호 자원 메타데이터와 검증기 설정 또는 오류 메시지다. 검증은 단계마다 결과(조직, scope 또는 거절)와 그 단계에서 일어난 HTTP 요청의 URL과 `Accept` 값이다 |

`material.json`의 키와 토큰은 이 fixture에서만 쓴다. 생성기는 실행 동안 `Date`를 고정 시계로 바꾼다. 시작 시각은 `cases.json`의 `now`이고 단계의 `advance`만큼 이동한다.

## 고정하는 동작

- 설정: `MCP_OAUTH_AUTHORIZATION_SERVERS`가 비어 있지 않을 때만 켜진다. URL은 HTTPS여야 하고 fragment를 쓸 수 없으며, WHATWG URL 직렬화 결과를 쓴다. 이 직렬화는 scheme과 host를 소문자로 바꾸고, 기본 포트를 지우고, 빈 경로를 `/`로 만든다. 빈 query `?`와 빈 fragment `#`는 남는다. 보호 자원 경로는 `/` 또는 `/mcp`만 허용한다. 숫자 옵션과 문자열 옵션은 각자의 오류 메시지를 낸다.
- issuer: 설정 URL과 끝의 `/`를 뺀 URL이 후보다. 토큰 `iss`가 후보에 없으면 HTTP 요청 없이 거절한다.
- 발견: JWKS URL이 없으면 인가 서버 메타데이터 URL을 순서대로 시도한다. 성공한 `jwks_uri`만 캐시하고, 실패하면 다음 요청에서 다시 시도한다. 리다이렉트는 실패로 처리한다.
- JWKS: 상태가 정확히 200인 JSON JWK Set만 받는다. 10분 동안 캐시한다. 맞는 키가 없을 때는 마지막 조회 후 30초가 지난 경우에만 한 번 다시 받는다.
- 키 선택: `kid`, `kty`, `alg`, `use`, `key_ops`, `ext`, `crv` 조건을 거친 후보가 정확히 하나여야 한다. 비공개 키, 2048비트 미만 RSA, `verify` 외의 `key_ops`는 거절한다.
- 토큰: compact JWS 세 부분, 허용 알고리즘, `crit`·`b64` 규칙, 서명, `iss`·`aud` 필수, `exp`·`nbf`의 허용 오차, 선택적 `typ`을 검사한다. base64url은 Node 24의 `atob` 경로를 따른다. 그래서 공백을 무시하고, 길이가 4의 배수일 때 패딩을 받아들이고, `+`·`/`는 거절한다.
- 결과: `scope`와 `scp`에서 중복 없는 scope 목록을 만든다. 조직 클레임이 있으면 비어 있지 않은 문자열이어야 하고, trim한 값을 쓴다.
