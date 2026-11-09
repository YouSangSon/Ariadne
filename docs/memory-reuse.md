# 기억의 재확인·정정 영향·효용 비교

기억에 재확인 방법을 붙이고, 정정할 때 다시 살필 기록을 찾으며, 기억을 포함하거나 제외한 실행의 결과와 비용을 비교한다. 재확인 설명은 도구 실행 허가가 아니다. 등록된 관계는 사실성이나 모든 의존 관계의 증명이 아니다.

현재 단계: 구현과 로컬 검증 완료. 기준은 `3f1db36`이다. 실제 모델 효용 실험과 사용자 DB migration은 이 작업에 포함하지 않는다. 요구사항 정본은 [memory-reuse REQ](../.harness/reqs/memory-reuse.yaml)다.

후속 원문 근거·안내/선택 조회·정정 후보·제한된 정비는 [상세 설계](memory-evolution-design.md)에서 다룬다. 해당 기능은 아직 구현하지 않았다.

## 적용 범위와 선택

사용자가 승인한 세 항목을 기존 Memory와 Evaluation에 추가한다. [하네스 설계](harness-synthesis-design.md)의 HS-D03·D12·D13과 HS-X01·X02를 유지한다. Memory의 저장 정책을 Context나 Ontology가 대신 소유하지 않는다. Memory만 사용해도 재확인과 영향 조회가 가능하다.

| 대안 | 판단 |
| --- | --- |
| 기존 기억에 선택적 구조화 필드 추가 | 채택. 같은 조직·범위·쓰기 경로·보관 계약을 재사용한다. |
| 별도 로컬 JSON 장부 | 제외. DB 기억과 두 정본이 생기고 권한·복구 상태가 분리된다. |
| 독립 평가 이력 테이블과 자동 정리 서비스 | 이번 범위에서 제외. 재확인 실행·주체별 인증·장기 이력 정책까지 새로 필요해진다. |

Anthropic의 [메모리 구성 요소](https://www.anthropic.com/research/components-of-agent-memory)는 원본 기록과 기억 및 파생 표현을 구별한다. 여기서는 그 구분을 적용하되 자동 dreaming이나 공급자별 서비스는 도입하지 않는다. 논문 실험의 절감량은 Ariadne의 성과가 아니다.

## 1. 재확인 방법을 기억과 함께 보관

`revalidation`은 기억의 재확인 설명과 보고된 출처·의존 관계다. `update_memory`에서 선택적으로 저장하거나 `null`로 제거한다. 메타데이터가 없는 기존 기억과 호출은 유지한다.

| 값 | 의미 |
| --- | --- |
| `schemaVersion` | 입력 형식 버전 1 |
| `recheck.method` | 무엇을 확인할지 설명하는 문장. 실행할 shell이나 tool 호출이 아니다. |
| `recheck.trigger` | 언제 다시 확인할지 설명하는 문장 |
| `recheck.boundContentDigest` | 이 설명을 연결한 기억 내용의 식별값 |
| `sourceObservations` | 보고된 외부 참조와 내용 해시. 현재 원본을 읽었다는 인증이 아니다. |
| `dependencies` | 같은 조직·범위의 다른 기억 ID와 관측한 내용 해시 |
| `derivatives` | 이 기억에 의존한다고 등록한 summary/wiki/context의 owner·참조·해시 |

기록 조회는 서로 다른 두 해시를 반환한다. `contentDigest`는 기억 ID·조직·범위·sourceId·kind·title·content·summary를 식별한다. `recordDigest`는 이 내용과 재확인 정보·tags·durability·importance 등 현재 수정 가능한 상태를 식별한다. 해시는 내용 동일성을 대조할 뿐 시간 순서·영구 이력·정확성을 증명하지 않는다.

재확인 정보를 수정하거나 제거하려면 마지막으로 읽은 `expectedRecordDigest`를 함께 보내야 한다. 저장소는 같은 transaction 안에서 행을 잠그고 기대값을 대조한다. 본문이 같더라도 다른 요청이 재확인 설명만 바꿨다면 이전 값으로 덮어쓰지 않는다.

기존 호출이 본문만 수정하면 예전 재확인 정보와 연결 해시는 보존한다. 다음 읽기에서 연결이 맞지 않음을 표시한다. 새 본문에 예전 근거를 자동 연결하지 않는다. 외부 source 행의 `content_hash`는 현재 원본 해시로 사용하지 않는다.

`bindingMatchesRecord`와 `sourceCurrentness`는 별개다. 기억 본문과 설명의 연결이 맞아도 외부 원본의 현재 상태는 `unknown`이다. `basis`는 `reported`이며 `verified`로 승격하지 않는다. 이 구분은 JSON 응답뿐 아니라 모델에게 전달하는 context markdown에도 표시하고 출력 예산에 포함한다.

문자열·배열·총 직렬화 크기를 제한하고 알 수 없는 필드를 거절한다. 설명·경로·참조에도 기존 비밀정보 검사를 적용한다. Markdown에 표시할 때 메타데이터를 실행 지침이나 신뢰할 수 있는 링크로 승격하지 않는다.

### 호출 순서

1. `list_memory` 또는 검색 결과에서 대상 기억의 `contentDigest`와 `recordDigest`를 읽는다.
2. `update_memory`에 다음 구조를 보낸다. 아래 해시 자리표시는 실제 조회 값으로 바꾼다. HTTP 경로는 `POST /v1/memory/update`이며 기존 인증·조직 판정을 따른다.

```json
{
  "memoryId": 42,
  "expectedRecordDigest": "<조회한 recordDigest>",
  "revalidation": {
    "schemaVersion": 1,
    "recheck": {
      "method": "서비스 설정의 endpoint 값을 확인한다",
      "trigger": "설정 배포 이후 또는 연결 실패 시",
      "boundContentDigest": "<조회한 contentDigest>"
    },
    "sourceObservations": [],
    "dependencies": [],
    "derivatives": []
  }
}
```

3. HTTP 409 충돌이면 기록을 다시 읽고 변경 내용을 대조한다. 예전 기대값으로 재시도를 반복하지 않는다. 제거도 `revalidation: null`과 최신 `expectedRecordDigest`가 필요하다.
4. 정정 이후 `inspect_memory_impact` 또는 `POST /v1/memory/impact`에 `{"scope":"project","projectKey":"my-project","changedMemoryIds":[42]}`를 보낸다. 결과에 등록된 기억·산출물을 검토한다. 도구가 외부 자료를 갱신하지는 않는다.

재확인 JSON은 32 KiB, 배열별 64개, method 4,096자, 다른 설명·참조는 1,024자 이하다. 내용 해시는 소문자 SHA-256 64자리다. 기억을 변경하면서 설명도 바꾸려면 새 내용에 대한 연결 해시가 필요하므로, 일반 호출자는 본문 수정 결과를 다시 읽고 재확인 정보를 별도로 연결할 수 있다.

## 2. 정정 영향 조회

`inspect_memory_impact`는 명시한 조직·project/user 범위에서 등록된 관계를 역방향으로 탐색한다. 입력은 변경된 기억 ID 또는 외부 출처 참조다. 여러 단계의 영향과 등록된 파생 산출물을 반환하되 조회 결과로 외부 산출물을 수정하거나 작업을 재개하지 않는다.

범위의 기록을 한 SQL statement로 제한 조회한 뒤 순수 함수에서 탐색한다. `limit + 1`개를 읽어 잘림을 판별하며 순환은 방문 집합으로 종료한다. 기록 수의 제한과 의미상 의존 관계의 완전성을 분리한다. 기본 100개·최대 1,000개 기록을 읽고, 파생 산출물도 최대 1,000개 반환한다. 어느 상한이든 초과하면 잘림을 표시한다.

| 상태 | 해석 |
| --- | --- |
| `registered_scan_complete` | 이번 범위의 등록 목록을 상한 안에서 읽었는지 |
| `truncated` | 등록 목록이 상한을 넘었는지 |
| `unresolved_dependencies` | 조회 범위에서 확인할 수 없는 의존 관계 |
| `broader_review_required` | 등록되지 않은 관계까지 고려한 추가 검토 필요 여부 |

초기 버전의 의미상 coverage는 항상 보고된 관계 수준이다. 목록을 전부 읽었다고 모든 실제 의존성을 안다고 표시하지 않는다. 빈 결과는 **등록된 영향이 없음**이며, 나머지 검사나 산출물을 재사용해도 된다는 뜻이 아니다.

삭제·보관된 기억과 확인하지 못한 외부 owner는 활성 근거로 취급하지 않는다. 다른 조직이나 범위의 기억 존재·본문을 조회해 누락 사유를 설명하지 않는다. derivative의 참조가 있다고 실제 위키 접근 권한이나 수신 모델의 현재 문맥을 확인한 것도 아니다.

## 3. 기억 하나의 효용 비교

`Ariadne eval memory-ablation`은 이미 기록된 실행을 읽는 오프라인 비교다. baseline에는 대상 기억이 없고 selected에는 같은 기억의 고정된 내용 해시가 있다. 나머지 기억·보호 지침·설정은 같아야 한다. 필수 기억은 제외 실험의 대상으로 받지 않는다.

기존 `eval compare` v1은 바꾸지 않는다. 별도 envelope에서 조직·범위, 대상 기억, 조건별 선택과 hash, 예정 case·identity·시도 상한을 대조한 다음 기존 비교기를 사용한다. 조건 hash는 공통 설정과 기억 선택을 함께 식별하며 코드 commit hash만을 뜻하지 않는다.

양쪽 모두 빠진 예정 case도 누락으로 표시한다. 취소나 조기 중단은 재시도를 강제하지 않고 비교 불충분으로 남긴다. 모든 실패·재시도 사용량을 보존하고 미측정 비용을 0으로 바꾸지 않는다. 기억 구축·검증·유지 비용은 실험 전체에서 한 번 계상하며 한 조건에 임의 배분하지 않는다.

이 계획과 실행은 보고된 자료다. 해시가 있다고 실험 사전 등록·모델 실행·검사 결과를 인증하지 않는다. 자동 승격이나 인기 점수 계산은 없다. 개발 과제로 정책을 선택했다면 별도의 고정 과제로 확인해야 한다.

## 저장·보관·복구와 호환성

`016_memory_revalidation.sql` migration은 canonical 기억과 archive에 선택적 JSONB 필드를 추가한다. 기존 행은 재확인 정보가 없는 상태로 유지한다. 기존 백업 방식의 전체 DB dump는 필드를 포함해야 하며 보관 후 복구 흐름도 정보를 잃지 않아야 한다.

compaction 복구는 새 기억 ID를 부여한다. 과거 설명과 관측은 보존하지만 새 ID에 예전 연결을 유효하다고 자동 인증하지 않는다. 다른 기억이 참조한 옛 ID는 미해결로 남겨 사람이 확인하도록 한다. 일반 archive와 compaction의 실제 삭제를 구분한다. 영향 조회는 canonical 기록과 soft-archived 기록을 대상으로 하며, 물리적으로 옮긴 archive snapshot은 탐색하지 않는다.

배포 시 신규 코드를 시작하기 전에 migration을 적용해야 한다. 이번 작업은 테스트 전용 DB만 변경한다. 구버전 애플리케이션으로 복귀해야 할 때 신규 필드를 즉시 삭제하지 않는다. 특히 구버전 보관·복구 writer는 신규 정보를 잃을 수 있으므로 혼합 버전 writer를 운영하지 않는다. 운영 DB 전환과 보존 정책은 별도 배포 작업이다.

## 검증 시나리오

| 사례 | 확인할 결과 | 계층 |
| --- | --- | --- |
| MR1 재확인 설명 저장·조회 | 내용 연결과 보고된 관측 및 원본 현재성 미확인 표시 | 도메인·HTTP/MCP·PG |
| MR2 메타데이터만 동시 수정 | 오래된 recordDigest로 덮어쓰기 거절 | PG |
| MR3 기존 호출로 본문 수정 | 예전 메타데이터 보존과 연결 불일치 | PG·문맥 |
| MR4 직접·전이·순환 영향 | 같은 범위의 등록된 영향만, 순환 종료 | 도메인·PG |
| MR5 다른 조직·누락·잘림 | 정보 노출 없이 미해결/추가 검토 표시 | API·PG |
| MR6 보관·복구 | 정보 보존, 새 ID 연결 불일치, 옛 의존 ID 미해결 | PG |
| MR7 악성·비밀·과대 메타데이터 | 경계에서 거절하고 실행하지 않음 | 입력·출력 |
| MR8 기억 하나만 다른 비교 | 조건·과제·해시 대조, 필수 기억 제외 거절 | 단위·CLI |
| MR9 누락·회귀·비용 미측정 | 불충분을 유지하고 전체 비용 한 번 계상 | 단위·CLI |

실행한 검사·실패·환경·정리 근거는 같은 작업의 private handoff에 기록한다. 코드 구현·로컬 검사·실제 메모리 효용·CI·배포는 각각 별도 상태다.


검증 연결: MR1·MR3·MR4·MR5·MR7은 [재확인 도메인·전송 검사](../packages/memory/tests/revalidation/), MR2·MR3·MR5·MR6은 [PostgreSQL 저장소 검사](../packages/memory/tests/store/memory-repository.test.ts), HTTP/MCP 연결은 [HTTP 서버 검사](../packages/memory/tests/app/server.test.ts)와 [MCP 서버 검사](../packages/memory/tests/mcp/server.test.ts)에 연결한다. MR8·MR9는 [기억 비교 검사](../tests/memory-ablation.test.mjs)와 [제품 CLI 검사](../tests/product-cli.test.mjs)에 연결한다.


### 로컬 검증 결과 (2026-11-09)

- `npm run verify -- --modules memory,ontology`: root source·mirror·commit 계약과 Memory typecheck 통과. Memory 전체 검사는 2,884 통과·50 건너뜀·9 실패였다. 실패는 문서 목록·catch 표기·복원 fixture 인자 대조에서 발생했다.
- 해당 원인을 수정한 후 public-docs-drift/source-conventions/unarchive-atomic/MCP 4개 파일의 207개 검사와 typecheck가 통과했다. 변경되지 않은 전체 검사 근거를 재사용했으며 전체 명령을 다시 실행했다고 주장하지 않는다. 의존성 감사는 취약점 0건이다.
- 별도 Podman PostgreSQL에서 저장소·동시성·ingest·migration 258개 통과. 기본 실행에서 빠진 실제 pgvector 연결 사례도 별도로 1개 통과했다.
- 실제 제품 CLI 3개, 기억 비교의 계획 누락·미완료 비용 회귀를 포함한 검사가 통과했다. 비교 입력 예제는 합성 자료이므로 실제 토큰 절약 성과를 뜻하지 않는다.
- 작업 전용 Podman 컨테이너와 tmpfs DB를 제거했다. 기존 이미지·다른 컨테이너·dist·공유 Vitest 캐시는 보존했다. 원격 CI·운영 migration·배포·실제 모델 효용 실험은 수행하지 않았다.
