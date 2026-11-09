# Ariadne Go + Rust 전환 설계

작성: YouSangSon의 요청을 바탕으로 Codex 작성 · 2026-11-09
상태: 목표 설계 작성과 독립 리뷰 완료. Go/Rust 런타임·빌드·배포는 아직 구현하지 않았다.
기준: `6a0c4589d6b055a3b33f5489a45fd5808895d193`. 요구사항: [go-rust-runtime-design](../.harness/reqs/go-rust-runtime-design.yaml).

## 1. 목표와 적용 범위

Go가 모듈의 업무 규칙과 실행 수명을 맡고, Rust는 필요한 계산을 수행하는 선택적 실행 파일로 둔다. 사용자는 하나의 Ariadne를 설치하며, 온톨로지만 사용할 때 Code 엔진이나 Memory DB를 시작하지 않는다. 언어가 달라도 기존 기억·분석 결과·권한과 명령의 의미는 유지한다.

언어 선택보다 우선하는 구조는 **DDD + 클린 아키텍처 + 모듈형 모놀리스 + 필요한 경계의 Ports & Adapters**다. TDD(기대 동작이 실패하는 테스트부터 만드는 개발 절차)로 각 변경을 구현한다. 이 기준은 사용자가 처음 요청한 아키텍처를 구체화한 것이며 Go+Rust로 바꾼다고 완화하지 않는다. 서비스 분리가 필요해지면 같은 업무 경계와 공개 계약을 활용한다.

후속 [모듈과 사용자 확장 설계](extension-platform-design.ko.md)는 안정적인 공개 확장 계약과 비신뢰 사용자 code의 실행 경계를 추가한다. 이 문서의 native compute는 계속 신뢰된 계산용이며 사용자 WASM sandbox와 구분한다. 선택 설치가 모듈화 전체를 뜻하지 않는다.

이 문서는 언어 전환의 목표 구조, 내부 통신, 빌드·배포, 호환성 검증과 이행 순서를 소유한다. 기존 [전체 리팩토링 설계](full-refactor-design.ko.md)의 모듈 소유권과 [실행 정책](execution-policy.md)은 유지한다. 이번 작업은 설계 문서와 로컬 커밋까지다. 런타임 구현, 데이터 이전, 원격 게시, MSA 배포를 시작하지 않는다.

완료조건은 다음과 같다.

1. Go·Rust·기존 JS/TS의 책임과 데이터 소유자를 구분한다.
2. 선택 설치, 프로세스 통신, 취소·종료·실패와 버전 계약을 구현 가능한 수준으로 정한다.
3. 기존 CLI·HTTP·MCP·저장·JS export 계약의 보존 방법과 전환 중단 조건을 연결한다.
4. 빌드·지원 플랫폼·Podman 검증·자원 정리·성능 비교 기준과 독립 설계 검토를 남긴다.
5. 업무 모델·계층 의존·모듈 확장과 TDD의 구현 순서를 자동 검사 및 인수 시나리오에 연결한다.

새 dispatcher, 자동 복구, 새 인증 정책, Kafka/RabbitMQ 및 새로운 DB 지원을 언어 전환에 끼워 넣지 않는다. 해당 기능은 기존 목표 설계의 별도 단계다. 모델 토큰 절감률이나 Rust의 속도 우위를 설계만으로 주장하지 않는다.

## 2. 현재 구조와 자원 근거

현재 실행 경로는 `bin/Ariadne.mjs` → `core/domain/product.mjs:commandPlan` → `lib/command.mjs:runCommand` → 선택 명령이다. 런처는 자식 Node 프로세스의 종료를 기다린다. `lib/module-selection.mjs:selectModules`는 `core,memory,code,ontology`를 선택하며 core는 항상 포함한다. 선택은 설치·검증 명령에만 적용되고 저장되지 않으며 데이터나 다른 명령을 삭제하지 않는다.

| 현재 계약 | 확인한 정본 | 전환에 주는 제약 |
| --- | --- | --- |
| 업무 경계·안쪽 의존 | [architecture.md](architecture.md), 루트/패키지 `architecture-map.json` | 언어별 폴더가 아니라 같은 업무 경계를 유지 |
| Memory 쓰기 | `packages/memory/src/application/ports/memory-write.ts`, PostgreSQL adapter | 락·원본·pgvector 쓰기에 같은 예약 연결과 쓰기 범위 유지 |
| Code 게시 | `packages/code/src/infrastructure/sqlite/indexing.ts: persistCollectedIndexRun` | 계산 후 최신 head 검사와 SQLite transaction/savepoint 유지 |
| 코드 파싱 | `packages/code/src/infrastructure/extractors/multi-language-regex.ts` | `ts.createSourceFile` 기반 결과를 다른 파서와 동등하다고 가정하지 않음 |
| 기억 재사용 | [memory-reuse.md](memory-reuse.md), [후속 기억 설계](memory-evolution-design.md) | 보고된 출처·현재성 unknown·조직/scope·정정 충돌 검사 보존 |
| 파일/보안 경계 | [consolidation.md](consolidation.md#file-and-configuration-concurrency) | `/source` 410 유지. Rust가 경로 경합이나 OS 격리를 자동 해결하지 않음 |

2026-11-09 동일 작업공간에서 `du -sk`로 확인한 개발 설치량은 Code `node_modules` 554,584 KiB, Memory 606,088 KiB다. 합계 약 1.11 GiB이며 ONNX node/web 패키지는 두 트리에서 875,584 KiB, 약 75.4%다. 두 `dist` 합계는 7,724 KiB다. 개발 의존성과 플랫폼 파일을 포함하고 모델 다운로드·외부 DB·Node 실행 파일은 제외한다. 물리 공유 블록, 실행 RSS, 배포 압축 크기를 측정한 값이 아니다. 기존 lockfile 두 개를 삭제하거나 ONNX를 모두 제거해도 된다는 근거로 쓰지 않는다.

실제 CPU·최대 메모리·시작 지연·조직별 부하·서비스 SLO는 미측정이다. 임베딩 엔진·모델을 유지한 채 조율 코드만 바꾸면 그 비용은 남는다. 프로세스와 모델 중복 적재, 의존성 설치 범위도 언어와 별도로 비교한다.

## 3. 결정과 대안

| ID | 결정과 상태 | 근거·손익 |
| --- | --- | --- |
| GR-D01 | Go 중심 + 선택적 Rust 엔진을 목표로 설계 | 사용자의 “go + rust로 설계해줘”. 전면 재작성 실행 승인은 아님 |
| GR-D02 | 업무·저장 규칙은 Go의 기존 모듈 경계로 이동 | 기존 DDD·클린 아키텍처 요구. Rust에 정책의 두 번째 정본을 만들지 않음 |
| GR-D03 | 최초 연결은 로컬 subprocess, 요청 하나당 프로세스 하나 | 설계 제안. C ABI와 네트워크 운영을 피하지만 시작·복사 비용을 수용 |
| GR-D04 | Rust 첫 후보는 co-change 빈도 집계만 | 설계 제안. 순수 입력으로 검증 가능하나 성능 이득 미확인 |
| GR-D05 | 기존 계약을 유지하며 모듈 단위로 전환 | 이전 사용자의 데이터 보존·모듈 선택 요구. 이행 중 TS runtime을 유지하는 비용 수용 |
| GR-D06 | Rust는 DB·파일·네트워크·모델 호출을 직접 소유하지 않음 | 첫 계산 경계의 설계 제약. 별도 프로세스 자체가 보안 sandbox는 아님 |
| GR-D07 | 성능과 호환성이 검증된 경로만 기본값으로 전환 | resource 절감 목적. 느린 Rust 시험을 제품 기본값으로 강제하지 않음 |
| GR-D08 | 다중 인프라·MSA는 기존 목표 계약을 계승 | 언어 혼합을 이유로 서비스·브로커·저장소를 추가하지 않음 |
| GR-D09 | DDD·클린 아키텍처·모듈화·확장성을 유지하고 TDD로 구현 | 사용자의 후속 명시 요구. 계층 이름보다 업무 규칙·안쪽 의존·실패 테스트와 실제 저장 검증을 완료 기준으로 사용 |

이 결정 표에서 사용자 선택은 GR-D01·GR-D09와 기존 모듈·안전 요구다. 통신 형식과 파일 배치 등은 구현을 위한 설계 제안이며 사용자가 개별적으로 승인한 정책이라고 기록하지 않는다. 과거 기억 설계 §13의 “언어 가능성만 검토”에서 이번 요청은 Go+Rust 목표 설계로 범위를 확장한다. 과거 구현 상태와 검증 근거는 바꾸지 않는다.

| 구조적 대안 | 숨기는 복잡성과 호출자 책임 | 이번 판단·재검토 조건 |
| --- | --- | --- |
| Go 모듈형 호스트 + Rust 실행 파일 | 계산 포트가 framing·버전·프로세스 수명·상한을 감춤. 호출자는 snapshot과 결과 적용을 소유 | 채택. 단일 설치와 단계적 비교에 적합 |
| Go + Rust C ABI 라이브러리 | 통신 복사는 줄일 수 있으나 FFI의 메모리 수명·panic 경계·링커·cgo가 필요 | 보류. 직렬화/시작 비용이 실측 병목이고 ABI 검증 비용을 정당화할 때 |
| Go 서비스 + 독립 Rust 서비스 | 프로세스 위치를 숨기지만 인증·전송 실패·원격 입력 권한·독립 운영이 추가 | 보류. 독립 확장·장애 격리 요구가 관측될 때 |

대안 검토에서 가져온 부분은 깊은 계산 포트와 별도 프로세스의 장애 범위다. 원격 서비스의 결과 불명·인증 문제를 로컬 함수처럼 숨기지 않는다. 서로 다른 언어의 모든 함수에 포트를 만들지 않고 실제 계산 경계 하나부터 시작한다.

## 4. 사용 방식과 모듈 책임

아래 명령은 **목표 사용 예시이며 아직 제공하지 않는다**. 기존 Node 명령은 전환 완료 전까지 지원한다.

```sh
Ariadne ontology inspect --file modules/ontology/example.json
Ariadne context --root /path/to/project --req my-task
Ariadne code index
Ariadne memory serve
```

기존 `node --env-file=… bin/Ariadne.mjs …` 래퍼는 당장 제거하지 않는다. Go 경로의 환경 로딩 규칙은 Node의 값·우선순위·오류 계약과 비교한 뒤 도입한다. Go 실행 파일이 작업 디렉터리의 `.env`를 자동 탐색하거나 읽는 동작은 추가하지 않는다. 새 설정이 없다는 이유로 기존 credential을 복제하지 않는다.

| 업무 경계 | Go 목표 책임 | Rust / 기존 TS와의 관계 |
| --- | --- | --- |
| 제품 조립 | 모듈 명령 등록, 설치 구성, 시작·역순 종료 | Rust 파일 위치와 버전을 해석하는 유일한 composition |
| Requirements / Context | 요구사항·hash·필수 문맥·예산·선택 기억 | 문자열·hash·예산 동등성 검증 전 TS 유지 |
| Integration / Wiki / Evaluation | 설치 소유권·백업, 위키 게시, 기록 비교 | 기존 파일 의미와 실패 상태를 보존 |
| Ontology | 용어·관계·source digest·review freshness | 처음에는 Go만 사용. 큰 그래프 계산은 별도 근거가 있을 때 |
| Memory | 인증·조직/scope·기억 규칙·저장·재확인·정정 | PostgreSQL 및 검색 adapter를 Go owner가 조립. 임베딩 전환은 별도 gate |
| Code | 파일/Git 입력, 파서 선택, 영향 정책, SQLite 게시 | Rust는 숫자 ID 기반 계산. TS 파서·JS export 호환 경로는 필요한 동안 유지 |
| Execution | 현재 전송·파일 도구·수동 인계의 동등 구현 | dispatcher·자동 재개는 기존 별도 목표이며 여기서 활성화하지 않음 |

DDD는 업무 의미와 데이터의 소유 경계다. Go의 `domain`은 정책·값을, `application`은 유스케이스와 필요한 포트를 소유한다. `adapters`가 DB·HTTP·프로세스를 구현하고 `composition`이 연결한다. 도메인에 `exec.Cmd`, SQL 연결, 브로커 client, resource 이름 lookup을 노출하지 않는다. `context.Context`는 취소가 필요한 application/adapter 경계에서 사용한다.

다음은 **예정 배치**이며 실제 디렉터리가 아니다. 기존 JS/TS 폴더를 이번에 이동하지 않는다.

```text
runtime/go/go.mod, go.sum
runtime/go/cmd/Ariadne/main.go
runtime/go/internal/composition/
runtime/go/internal/{requirements,context,integration,wiki,evaluation,ontology,memory,code,execution}/
  domain/         업무 값과 규칙
  application/    유스케이스와 소비자가 소유한 포트
  adapters/       선택한 파일·DB·전송 구현
runtime/go/internal/platform/computeprocess/   계산 프로세스 실행과 종료
runtime/rust/Cargo.toml, Cargo.lock, rust-toolchain.toml
runtime/rust/crates/ariadne-compute/src/{main,lib,cochange}.rs
contracts/compute/v1/                         wire schema와 공통 fixture
```

Go `internal`만으로 내부 모듈 간 접근을 전부 막을 수 없으므로 architecture 검사에 허용 import와 Go/Rust 소스 전수 분류를 추가한다. 모듈끼리는 application의 공개 계약만 사용한다. native compute crate에는 순수 집계와 wire entrypoint만 둔다. 사용자 확장은 후속 확장 설계의 별도 worker·신뢰 계약을 따르며 compute crate를 범용 loader로 바꾸지 않는다.

### 4.1 DDD: 업무 규칙과 변경 경계

DDD의 bounded context는 같은 용어·규칙·데이터 의미를 소유하는 모듈 경계다. 언어, 테이블, HTTP endpoint를 기준으로 도메인을 나누지 않는다. Memory는 기억과 조직/scope·정정 충돌 규칙을, Ontology는 용어·관계·검토 상태를, Code는 분석 snapshot·근거·게시 규칙을 소유한다. Context는 필수 문맥과 예산을 소유하며 다른 owner의 원본을 직접 수정하지 않는다.

모듈 안에서 함께 일관성을 지켜야 하는 변경 단위가 aggregate(불변조건을 함께 지키는 업무 단위)다. 현재 Memory write scope와 Code publication의 원자적 변경 범위를 먼저 대조한다. 그 경계를 작은 repository 호출 여러 개나 Rust 계산으로 분산하지 않는다. 모든 테이블을 aggregate로 만들거나 전체 제품을 하나의 aggregate로 묶지 않는다. 업무상 ID·revision·scope 같은 값과 불변조건은 domain에 두며 DB row·HTTP JSON을 그대로 도메인 모델로 사용하지 않는다. 단순 값에는 불필요한 class를 추가하지 않는다.

application은 인증된 주체를 받아 유스케이스를 조율하고, 데이터 owner가 조직/scope와 현재 revision을 최종 검사한다. DTO(전송용 데이터)의 형식 검증은 입력 adapter에서 한다. 도메인 규칙 검증과 권한 검사는 해당 책임에서 유지한다. UI나 controller에 규칙을 몰아넣고 domain을 데이터 묶음으로만 남기지 않는다.

### 4.2 클린 아키텍처: 허용 의존과 공개 계약

목표 의존 방향은 다음과 같다. 표는 import 방향이며 런타임 호출은 주입된 포트를 통해 adapter로 나갈 수 있다.

| 위치 | 허용하는 의존 | 금지하는 결합 |
| --- | --- | --- |
| `domain` | 같은 모듈의 값·정책과 필요한 순수 라이브러리 | application·adapter·SQL·HTTP·프로세스·전역 설정 |
| `application` | 같은 domain과 소비자가 정의한 작은 포트 | 구체 DB/SDK client, concrete adapter 생성 |
| `adapters` | 자신이 구현하는 포트와 domain 값·외부 SDK | 다른 모듈의 repository·테이블 직접 접근 |
| `composition` | 선택한 모듈의 공개 계약과 adapter | 업무 판단을 새로 구현하거나 데이터 owner 우회 |

모듈 간 통신은 공개 application 계약과 직렬화 가능한 값으로 제한한다. 순환 의존은 거절한다. 외부 계약을 내부 모델로 변환하는 adapter가 버전·오류 차이를 흡수하며 모든 모듈이 함께 수정돼야 하는 거대한 공통 모델을 만들지 않는다. 실제 소비 경계가 있는 포트만 정의하고 모든 함수에 interface를 붙이지 않는다.

G0에서 현재 architecture 검사의 범위를 Go/Rust까지 확장할 계획을 고정한다. G1부터는 미등록 소스, domain의 I/O 의존, application의 구체 adapter import, 모듈 내부 침범과 순환 의존을 넣은 거절 fixture가 실패해야 한다. Go import graph와 Rust crate dependency는 도구로 확인하고 단순 폴더 이름만 검사하지 않는다. 실제 검사 구현·CI 연결은 후속 단계다.

### 4.3 모듈화와 확장 경로

확장은 기존 공개 계약을 유지하면서 새 adapter와 composition 등록으로 해결하는 것을 우선한다. 규칙 자체가 달라질 때는 domain 계약·시나리오를 함께 바꾸며 adapter 뒤에 정책 차이를 감추지 않는다.

| 확장 사례 | 추가·수정할 경계 | 유지할 계약과 검사 |
| --- | --- | --- |
| 새 DB/벡터 저장소 | 해당 owner의 의미 있는 repository·write scope adapter와 binding | 권한·원자성·freshness 적합성. 범용 CRUD로 통합하지 않음 |
| 새 모델/도구 실행기 | 해당 application의 provider port와 adapter | 입출력·권한·usage·취소·오류·모델 정체성 계약 |
| 새 Rust 계산 | 소비 모듈의 계산 포트와 versioned operation | bounded input·결과 동등성·종료·자원 비교 |
| Kafka/RabbitMQ 병용 | 각각 event stream/work queue 포트의 adapter | outbox/inbox·중복·순서·ACK 실패 계약을 지원 조합별 검증 |
| 모듈의 독립 서비스 추출 | 공개 application 계약에 연결하는 원격 adapter | 서비스 측 재인가·deadline·결과 불명·단일 writer·혼합 버전 |

선택하지 않은 모듈은 client·pool·worker를 시작하지 않는다. 같은 모듈 인스턴스 여러 개도 전역 singleton으로 연결을 덮어쓰지 않는다. 설치 선택, 실행 시 인프라 binding, 서비스 배포 단위는 각각 다르다. 이런 확장성은 모든 DB·브로커·모델을 미리 구현했다는 뜻이 아니며, 지원 표시는 실제 adapter 검증을 통과한 조합으로 제한한다.

## 5. 첫 Rust 계산: 함께 변경된 파일의 빈도

현재 `computeCoChanges`는 Git 이력에서 파일 쌍이 함께 등장한 횟수를 센다. `indexProjectInternal`이 확보한 이력과 파일 snapshot을 `persistCollectedIndexRun`이 받아 계산하고, 기존 SQLite 쓰기 경계에서 관계를 게시한다. `traverseImpact`는 이웃을 DB reader에서 반복 조회하므로 첫 순수 계산 후보로 옮기지 않는다. TS AST 파서도 교체하지 않는다.

첫 실험에서 **호스트**는 다음 순서를 유지한다.

1. commit 내부 파일을 중복 제거한다.
2. 포함 파일 필터를 적용하기 **전에** 전체 unique 파일 수로 noisy commit을 제외한다.
3. 실제 indexedFiles에 포함된 파일만 선택하고 기존 UTF-16 정렬 순서대로 요청 내 숫자 ID에 매핑한다. commit 배열은 원래 이력 순서를 유지하며 각 commit의 ID는 오름차순이다.
4. Rust에 파일 ID 배열을 전달한다. Rust는 파일별 빈도와 순서 없는 파일 쌍별 빈도, 각 쌍이 처음 등장한 순번을 반환한다. 첫 등장 순번은 commit 순서와 각 commit의 `i < j` 순회 순서로 부여한다.
5. 호스트가 쌍을 첫 등장 순서로 복원하고 `count / max(freqA, freqB)`, 임계값, 양방향 관계, confidence와 기존 stable sort를 적용한다.

Go도 같은 포트의 참조 구현을 갖는다. 계산 알고리즘만 두 언어에 존재하며 임계값·인가·결과 적용 정책은 owner 한 곳에 둔다. G2는 TS가 생성한 golden fixture와 Go→Rust 결과를 오프라인으로 비교한다. 기존 TS production pipeline은 수정하지 않고 TS→Go→Rust 중계도 만들지 않는다. 기존 동기 `computeCoChanges` 공개 export는 유지한다. G4에서 Go Code application이 계산을 기다린 뒤 동기 게시에 준비된 결과를 전달한다. Rust 대기 중 DB transaction을 열지 않는다.

기존 `.sort()`는 UTF-16 기준이고 최종 `localeCompare()`는 locale 영향을 받는다. G2의 오프라인 비교에서 TS oracle이 기존 정렬을 유지하고 Rust는 정수 ID만 정렬한다. 서로 다른 문자열인 `é.ts`와 `e\u0301.ts`의 비교가 0이면 stable sort는 기존 pair 삽입 순서를 유지한다. 따라서 counts가 같아도 첫 등장 순서를 버리면 호환되지 않는다. Go Code 전환 전에는 Unicode 정규화 동등 문자열·구두점·대소문자·한중일 파일명과 commit 등장 순서를 바꾼 fixture 및 locale 조건을 고정해야 한다. Go의 기본 문자열 정렬로 바꾸거나 출력 차이를 무시하지 않는다. 동일 정렬을 재현하지 못하면 Code의 TS 호환 경로를 유지한다.

`sqlite/indexing.ts`는 `couplingScore.toFixed(2)`를 provenance에 넣고, `index-policy.ts:relationId`는 그 문자열을 hash한다. `5/8 = 0.625` 같은 반올림 경계, IEEE-754 계산과 JS 숫자/JSON 문자열화, stable JSON bytes를 비교해 relation ID·근거 문자열까지 보존한다. 값이 대략 같다는 허용 오차로 ID 불일치를 통과시키지 않는다.

기본 상한은 1,500 commits, commit당 25개 파일이다. 이론상 쌍 증가 횟수는 최대 `1500 × 25 × 24 / 2 = 450,000`이다. 이는 성능 실측이 아니다. 첫 후보는 통신·취소·동등성 검증용이며 Rust 활성화를 정당화하는 성능 근거는 아직 없다.

### 계산 포트와 wire v1

아래 타입은 설계 예시다. `CountCoChanges(ctx, input) -> counts, error`는 인증된 Code 유스케이스만 호출한다. Rust에 조직 ID를 보내 인증했다고 간주하지 않는다. 호스트가 접근 범위를 결정하고 선택된 숫자 ID만 전달한다.

```json
{
  "protocol": "ariadne.compute/1",
  "operation": "cochange-counts/1",
  "requestId": "request-opaque-id",
  "inputDigest": "73c33205d9b30fdfdf31e08236aaf51c309f31ebab0c6e98910f013f94e732d6",
  "payload": { "fileCount": 3, "commits": [[0, 1], [1, 2]] }
}
```

성공 응답은 같은 protocol/operation/requestId/inputDigest와 `status: "ok"`, `frequencies: [1,2,1]`, `pairs: [[0,1,1,0],[1,2,1,1]]`를 담는다. pair의 네 값은 `a,b,count,firstSeenOrdinal`이다. 파일 ID는 0 이상 fileCount 미만이며 각 commit은 중복 없는 오름차순 ID 배열이다. pairs는 `a < b`, `(a,b)` 오름차순, 중복 없음, 양의 count이며 count는 두 파일 빈도를 넘지 않는다. firstSeenOrdinal은 0부터 pair 수 미만까지 중복 없는 순번이다. frequencies의 길이는 fileCount이고 각 값은 commit 수 이하다. 파일이 없는 빈 입력은 빈 결과다. host와 engine 모두 필수 필드·타입·범위를 검사하고 알 수 없는 v1 필드는 거절한다.

JSON의 숫자는 32bit unsigned 범위의 십진 정수 표기만 허용하며 음수·소수·지수 표기와 overflow를 거절한다. 부동소수점 score는 wire에 싣지 않는다. 중복 object key와 schema 밖의 중첩 값도 거절한다. requestId는 ASCII 영숫자·하이픈·밑줄 1..128자, inputDigest는 소문자 64자리 hex다. canonical payload는 UTF-8의 고정 key 순서 `fileCount,commits`, 공백 없는 십진 정수 JSON이다. host가 hash를 계산하고 engine이 같은 bytes 규칙으로 재계산한다. v1 fixture는 원문 bytes와 SHA-256을 함께 고정한다. requestId와 digest는 상관관계·입력 일치 검사이며 인증 수단이 아니다.

stdout/stdin은 4byte unsigned big-endian 길이 뒤 UTF-8 JSON 한 frame을 사용한다. 한 프로세스는 요청 하나와 응답 하나만 처리한다. 추가 frame, 뒤따르는 bytes, 짧은 frame, 잘못된 UTF-8·JSON, 잘못된 버전, 다른 requestId/digest를 거절한다. stdout은 프로토콜 전용이며 로그는 stderr로 분리한다. 오류 응답은 같은 envelope에 `status: "error"`와 §6의 code를 두고 counts를 포함하지 않는다. 사용자 payload를 되풀이하는 자유 형식 오류 메시지는 제공하지 않는다. envelope조차 해석할 수 없으면 frame 없이 nonzero exit한다. host는 성공 응답 검증과 정상 exit를 모두 확인하기 전 결과를 게시하지 않는다.

| 내부 초기 상한 | 제안값 | 초과 동작 |
| --- | --- | --- |
| 요청/응답 frame | 16 MiB / 32 MiB | 할당 전에 길이 거절, 결과 미게시 |
| commits / commit 파일 / fileCount | 1,500 / 25 / 37,500 | Rust 실험 입력 거절. 외부 기존 계약을 조용히 잘라내지 않음 |
| 한 요청의 pair 항목 | 450,000 | `LIMIT_EXCEEDED`, 부분 성공 금지 |
| 동시 Rust 요청 / 대기 요청 | 호스트당 1 / 0 | 포화 시 `BUSY`, 무제한 goroutine·queue 생성 금지 |
| wall deadline / 종료 대기 | 부모 잔여 시간과 30초 중 작은 값 / 2초 | 취소·종료·회수 후 실패 보고 |
| stderr 보관 | 64 KiB | 이후도 pipe를 drain하되 저장하지 않고 truncation 표시 |

이 값은 프로토콜 실험의 제한이며 제품 SLO나 기존 공개 입력 제한이 아니다. 측정 전 임의로 올리지 않는다. 더 큰 입력은 참조 경로로 **실행 전에** 선택하거나 명시 Rust 시험에서 실패시킨다. 실행 중 결과가 잘렸는데 성공이라고 반환하지 않는다. 첫 release의 기본 backend는 참조 구현이며 Rust 선택은 내부 실험 구성에만 둔다. 자동 fallback이나 새로운 공개 CLI 옵션은 첫 단계에 추가하지 않는다.

## 6. 프로세스·실패·보안 계약

Go의 계산 adapter가 실행 파일 확인, 한도, 시작, stdin 작성, stdout/stderr 소비, 종료 대기와 정리를 소유한다. 호출자는 결과 또는 분류된 오류 하나를 받는다. 실행 파일은 설치 manifest에 기록된 절대 경로·OS/CPU·protocol/operation 버전·hash와 대조하며 사용자 프로젝트의 PATH에서 검색하지 않는다. shell 없이 argv로 실행한다. hash 확인은 신뢰된 설치본 확인의 일부이며 설치 디렉터리를 바꿀 수 있는 공격자에 대한 sandbox 보장이 아니다.

Rust에 전달할 환경은 필요한 OS 실행 항목만 allowlist로 구성한다. DB/API token·사용자 HOME·workspace cwd를 그대로 상속하지 않는다. 작업 전용 빈 cwd와 필요한 pipe만 제공한다. 첫 엔진은 파일·네트워크·추가 자식 실행 API를 사용하지 않도록 source/dependency 검사를 둔다. 그 제한은 코드 계약이다. 신뢰하지 않는 임의 바이너리를 안전하게 실행하는 기능은 제공하지 않는다.

정상 흐름은 `admit → validate → start → write/drain → validate response → close stdin → wait → return → publish`다. 입력 writer와 두 output reader를 동시에 관리하여 pipe가 차서 멈추는 일을 방지한다. 출력은 한도를 넘어 누적하지 않으며 모든 경로에서 goroutine·pipe·프로세스 종료를 회수한다. 정상 종료 순서는 다음과 같다.

1. host가 요청 frame 전체를 쓴 뒤 stdin을 열어 둔다. engine은 길이로 frame 경계를 결정하므로 계산 시작을 위해 EOF를 기다리지 않는다.
2. engine의 별도 tail-reader는 요청 뒤 byte 또는 EOF를 감시한다. 추가 byte는 protocol 오류다. 응답 flush 전 EOF는 부모 소실/취소로 보고 계산을 중지한다.
3. engine은 결과 frame을 한 번 flush하고 EOF 확인을 기다린다. host는 frame을 읽어 검증한 뒤 stdin을 닫는다. 검증 실패해도 닫고 해당 결과를 버린다.
4. engine은 추가 byte 없이 EOF를 확인하고 tail-reader·계산 thread를 join한 뒤 종료한다. 뒤늦은 추가 입력이면 성공 frame을 이미 보냈더라도 nonzero exit한다.
5. host는 stdout의 trailing bytes/EOF와 stderr drain, `Wait`까지 확인한 후 성공을 확정한다. 양쪽 모두 자기 단계의 대기를 deadline 안에서 끝내므로 서로 EOF를 먼저 기다리는 구조를 만들지 않는다.

취소나 deadline 만료는 결과를 무효화하고 직계 자식 종료를 요청한다. 첫 순수 계산 엔진에는 저장할 상태가 없으므로 강제 종료가 허용된다. `CommandContext`만 호출하고 완료로 처리하지 않고 `Wait`와 I/O 종료를 확인한다. `WaitDelay`는 종료·pipe 대기의 보조 상한이며 전체 process tree 종료나 hard CPU/RSS 제한을 보장하지 않는다. 최초 엔진은 자식을 생성하지 않는다. 향후 외부 실행기를 허용하려면 Unix process group/Windows Job Object 같은 OS별 계약을 별도로 구현·시험한다.

부모가 비정상 종료하면 stdin EOF 감시로 Rust가 계산 취소를 관측하도록 설계한다. 응답 flush 전에는 bounded loop의 취소 지점에서 종료하고, flush 후 EOF는 정상 close와 구별할 필요 없이 정리 후 종료한다. engine에는 영속 부수효과가 없으며 host가 없으면 결과 게시도 없다. tail-reader의 판정과 response-flushed 상태는 동기화한다. 엔진 자체 watchdog도 30초 전체 수명을 제한하며 host의 더 짧은 deadline은 host가 강제 종료한다. 이 협조 종료가 무한 정지·OS 장애까지 보장하지는 않으므로 부모 강제 종료 시험과 잔여 PID 확인을 gate로 둔다. hard 메모리 격리가 필요한 배포는 Podman 등의 OS 자원 제한을 별도 적용한다.

| 실패 분류 | 처리 | 저장·재시도 |
| --- | --- | --- |
| `INVALID_INPUT`, `UNSUPPORTED_VERSION`, `LIMIT_EXCEEDED` | 해당 계산 거절 | 게시 없음, 재시도 없음 |
| `UNAVAILABLE`, `BUSY` | 누락 바이너리·지원 조합·동시 실행 부족 보고 | 자동 설치/재다운로드/반복 없음 |
| `CANCELLED`, `DEADLINE_EXCEEDED` | 종료와 pipe 회수 후 반환 | 늦은 결과 폐기, 부모 취소 뒤 재시도 없음 |
| `PROTOCOL_ERROR`, `ENGINE_FAILED` | 잘못된 출력·panic·비정상 exit 보고 | 부분 결과 미게시, 자동 fallback 없음 |
| 종료 확인 실패 | PID/오류를 비밀 없이 기록, 해당 runner 격리 | slot을 재사용하지 않고 새 계산 거절, 정리 성공으로 표시하지 않음 |

유효한 도메인 오류 frame을 반환했더라도 성공 결과는 아니다. 오류 frame을 읽지 못한 nonzero exit는 `ENGINE_FAILED`다. 원본 payload·파일 내용·credential을 오류나 로그에 넣지 않는다. 계산 자체는 부수효과가 없으므로 동일 입력 재계산이 가능하지만 첫 구현은 자동 재시도하지 않는다. DB 게시와 외부 도구 호출은 별도의 멱등성·결과 불명 계약을 유지하며 계산 재시도 안전성과 혼동하지 않는다.

## 7. 저장·인증·인프라 소유권

최종 목표에서도 Rust는 DB writer가 아니다. Memory/Code의 Go adapter가 해당 모듈 저장 계약을 구현한다. 이행 중에는 이전 TS owner가 계속 writer다. 새 Go writer를 열기 전에 기존 HTTP·CLI·MCP·worker·운영 스크립트 등 모든 writer 경로를 식별하고 중지하거나 같은 owner로 라우팅한다.

Memory는 조직/scope를 repository 조회·최종 수정 양쪽에서 검사한다. 인증 token을 engine에 넘기지 않는다. 같은 PostgreSQL 예약 세션에서 실행되는 락·원본·pgvector 작업은 연결 풀에서 각각 빌려 처리하지 않는다. Qdrant 등 별도 인덱스는 기존 indexing intent·재시도·가시성 계약을 유지한다. 기존 `ingest_jobs`는 범용 작업 원장으로 바꾸지 않는다.

Code는 분석 입력 snapshot·기존 head를 검증한 뒤 기존 SQLite 게시 transaction과 savepoint를 유지한다. 계산을 끝냈다는 이유로 stale 결과를 게시하지 않는다. 임베딩 모델 호출은 transaction 밖에 둔다. `.parallax/impact.db`에는 facts·branches·transactions도 있으므로 다시 만들 수 있는 캐시로 취급하지 않는다. 모델·차원·정규화·거리 함수·인덱스 버전이 바뀌면 기존 vector와 혼용하지 않고 별도 호환/재색인 계획을 요구한다.

임베딩 동등성은 모델 이름·차원만으로 판정하지 않는다. Code의 e5 모델 조건부 `passage:` prefix, q8 inference, mean pooling, JS int8 양자화와 Memory의 tokenizer·special token·입력 token 상한 거절·chunking을 함께 고정한다. 해당 전처리·후처리와 순위/거리 fixture를 통과하지 못하면 기존 adapter를 유지한다. Go+Rust 선택이 검증되지 않은 native ONNX 바인딩 채택을 뜻하지 않는다.

복수 DB·인증·캐시·Kafka/RabbitMQ 설계 정본은 [전체 설계 §9](full-refactor-design.ko.md#9-msa와-복수-인프라-확장-설계)다. Go composition이 이름 있는 resource를 역할에 binding하며 도메인에서 전역 lookup하지 않는다. stream과 work queue는 별도 포트, 캐시는 원본/권한 판정의 대체물이 아니다. pool·수명·namespace·조직 routing을 resource별로 둔다. 초기화 실패 시 열린 자원만 역순으로 닫는다. 동일 DB transaction 요구를 다른 DB 연결이나 브로커 ACK로 대체하지 않는다.

언어별 배포 단위를 서비스 경계로 간주하지 않는다. 서비스 추출 시에는 인증·deadline·결과 불명·outbox/inbox·단일 writer·혼합 버전·routing epoch와 복구 절차가 필요하다. 로컬 engine의 숫자 ID 프로토콜을 인증 없이 원격 공개하지 않는다. 이번 언어 전환 설계에는 새 브로커 설치나 임의 DB 조합 지원 약속이 없다.

## 8. 빌드·배포와 선택 모듈

목표는 최상위 명령 하나가 선택한 모듈의 빌드·검증·패키징을 수행하는 것이다. **예정 명령**은 `go run ./tools/build.go --modules core,ontology`이며 root에서 실행한다. 이 파일은 아직 없고 현재 `npm run setup/build/verify`를 대체하지 않는다. Go-only 선택은 Cargo를 요구하지 않는다. Rust 시험이 포함된 Code 빌드만 Cargo를 실행한다. 기존 전체 기본 선택과 엄격한 module 인자 검증은 유지한다.

Go는 한 module(`runtime/go/go.mod`), Rust는 한 workspace와 lockfile을 둔다. `go.sum`, `Cargo.lock`, `rust-toolchain.toml`과 Go toolchain을 고정하고 Go readonly 의존성 모드·Cargo `--locked`를 적용한다. 실제 버전은 G0에서 지원 SDK와 CI 조합을 확인한 후 pin한다. 이 문서가 현재 설치 버전이나 최신 버전을 추정해 고정하지 않는다. 네트워크로 toolchain/의존성을 가져오는 단계와 오프라인 빌드를 구분한다.

Go 기본 executable에는 core 기능만 직접 등록한다. 선택 모듈은 생성한 composition 파일의 명시 import로 등록한다. 생성기는 공개 module 목록과 허용 template만 사용하고 arbitrary source path를 입력받지 않는다. 등록·DB 초기화는 package `init()`의 부수효과에 맡기지 않는다. 생성 산출물은 작업 전용 경로에 두며 같은 소스 checkout의 동시 빌드가 서로 덮어쓰지 않게 한다.

최종 패키지는 `Ariadne` 실행 파일, 선택된 경우 `libexec/ariadne-compute`와 module runtime assets, manifest, LICENSE/제3자 고지를 포함한다. manifest에는 release ID, 선택 모듈, target triple, 파일 digest, 계산 protocol/operation 버전, 필요한 외부 runtime을 기록한다. 새 runtime을 먼저 임시 release 디렉터리에 완성·검증한 뒤 launcher를 전환하며 현재 release를 덮어쓰지 않는다. 실행 중 프로세스는 시작한 release 경로를 계속 참조한다.

선택하지 않은 모듈은 `module unavailable`로 명확히 알린다. 이는 기존 source setup이 명령을 숨기지 않는 계약과 다르므로 **선택 모듈 바이너리 배포에만** 적용한다. 기존 Node source 설치의 선택 동작은 그대로다. 제품 모듈 추가는 같은 release/target의 다른 패키지로 설치를 교체하는 방식부터 제공한다. 후속 사용자 확장 패키지는 별도 수명과 검증 진입점을 가지며 composition의 임의 native plugin loading을 허용하지 않는다. 어떤 경우도 모듈 선택으로 데이터를 삭제하지 않는다.

| 단계별 지원 목표 | 빌드·실행 검증 | 제한 |
| --- | --- | --- |
| macOS arm64, Linux amd64 | 해당 OS/CPU native runner에서 빌드·smoke | 최초 검증 목표이며 현재 지원 완료 아님 |
| macOS amd64, Linux arm64, Windows amd64 | 각각 native runner에서 signal/pipe/path·패키지 검증 | 해당 검증 통과 뒤에만 release matrix에 추가 |

Rust target 설치만으로 linker·시스템 라이브러리·native SDK가 준비됐다고 가정하지 않는다. Linux libc 최소 버전과 동적 라이브러리를 manifest에 명시하고 clean 환경에서 검사한다. 처음부터 모든 target을 macOS 하나에서 cross compile하지 않는다. Windows 이름·권한·종료 방식은 별도 검증한다.

Core/ontology가 Go로 완전히 전환되면 그 배포에는 Node/Rust toolchain이 필요하지 않는 것이 목표다. Code의 TS parser/export 또는 Memory의 기존 transformers adapter가 남아 있으면 Node가 필요한 **과도기 패키지**라고 표시한다. 최종 사용자에게 Go/Cargo compiler를 요구하지 않는 것과 Node/ONNX runtime이 전혀 필요 없는 것은 다른 주장이다. 모든 모듈을 Node 없이 배포하려면 파서·SQLite/vector·임베딩의 동등성 gate를 각각 통과해야 한다.

## 9. 전환 순서와 되돌리기

각 단계의 현재 상태는 모두 미구현이다. 같은 단계에서 언어·DB schema·업무 정책을 함께 바꾸지 않는다. 먼저 참조 결과를 고정하고 한 command family 또는 owner씩 전환한다.

| 단계 | 구현 단위 | 통과 조건·중단 조건 |
| --- | --- | --- |
| G0 | 계약 fixture·자원 baseline·toolchain/SDK 적합성·계층 검사 계획 | 현재 CLI/HTTP/MCP/export·숫자·hash·오류·보안 fixture와 측정 환경 확보. domain I/O·모듈 침범·순환 의존의 거절 기준 고정. 중요한 계약 미해결이면 해당 owner 전환 보류 |
| G1 | Go core/ontology, 기존 Node 호환 wrapper | module 선택, cwd/env/exit/signal, context hash/예산, source review 결과 동등. Memory/Code는 기존 owner 사용 |
| G2 | Rust count kernel + Go process adapter + TS golden fixture 비교 | 기존 TS production은 무변경. Go→Rust 두 프로세스의 성공·오류·취소·EOF·상한·혼합 버전·결과 동등성. 속도 손해면 기본 backend 변경 금지 |
| G3 | Go Memory adapter와 외부 계약 | org/auth·예약 세션·vector/backup/migration·HTTP/MCP 동등. 유료 provider 자동 선택 금지 |
| G4 | Go Code 조율·저장과 선택 Rust 적용 | TS semantic parser, JS exports, SQLite extension, locale/ID/hash, 게시 경합과 데이터 복구 동등. 대체 불가 기능은 기존 경로 유지 |
| G5 | 배포 matrix·운영 검증·구 경로 축소 | clean 설치/업데이트/rollback, 필수 CI와 보안 검사. 참조 구현·공개 export 삭제는 소비자 이행 확인 뒤 별도 변경 |

읽기 shadow는 같은 snapshot으로 양쪽 결과를 비교하며 원본에 쓰지 않는다. 모델 호출 shadow는 비용이 생기므로 기본 검증에서는 하지 않는다. 쓰기는 동시 dual writer를 열지 않는다. 대상 owner의 ingress 중단 → 진행 작업 종료 확인 → 검증된 backup → 새 owner smoke → 단일 writer 전환 순서다. 기존 TS 코드가 새로운 fencing을 이해한다고 가정하지 않으므로 구 writer 프로세스·wrapper·worker를 실제 중지/차단하는 절차가 먼저다.

schema·DB를 그대로 유지하는 전환은 신규 writer가 구 reader와 호환되는 데이터만 쓰는 동안 이전 실행 파일로 rollback할 수 있다. 새 schema·형식·외부 효과를 도입했다면 binary 교체만으로 되돌아간다고 주장하지 않는다. writer 중단, 이전 형식 가독성, backup 복원 또는 역동기화, 진행 operation의 결과 대조가 먼저다. rollback 가능 여부를 owner별로 기록하며 전체 설치 성공과 데이터 이전 성공을 구분한다.

공개 JS export는 Node 호환 패키지에서 기존 동기/비동기 형식과 오류를 유지한다. 내부 계약 fixture인 `packages/code/tests/fixtures/architecture/public-exports.json`과 실제 소비자를 대조한다. 단순 CLI subprocess wrapper로 synchronous library API를 모두 대체하지 않는다. 기존 SQL migration 파일과 schema ledger는 데이터 owner가 계속 관리하고, 다른 언어에서 startup마다 migration을 중복 실행하지 않는다.

## 10. 구현 대상과 검증 계획

아래 경로는 **후속 구현 계획**이다. 현재 생성된 Go/Rust 소스나 실행한 검사가 아니다. 모듈별 상세 파일 목록은 해당 단계의 G0 대조 뒤 기존 owner 안에서 정하며, 미확인 파일을 이미 존재하는 것처럼 링크하지 않는다.

### TDD로 구현하는 순서

G0부터 G5까지 기능·버그 변경은 아래 순서를 따른다. 문서 변경과 기계적 이동에는 억지 실패 테스트를 만들지 않는다. 동작 보존 이식에서는 현재 구현의 특성화 테스트를 먼저 확보하되, 알려진 정책 위반을 목표 동작으로 고정하지 않는다.

1. 해당 GR-S와 기존 업무 계약에서 관측 가능한 기대 결과를 고른다. domain 규칙, application 호출, adapter 계약, 실제 저장 정합성 중 가장 직접적인 계층에 테스트를 둔다.
2. 그 동작이 아직 없거나 잘못되어 실패하는 것을 실행 결과로 확인한다. 문법 오류·환경 누락으로 실패한 것을 기능 실패 재현으로 계산하지 않는다. 기존 TS 특성화는 통과 기준으로 보존하고, 새 Go/Rust 경로에는 같은 계약의 미충족을 확인한다.
3. 해당 결과를 만족하는 최소 구현으로 통과시킨다. 구체 DB를 application에 넣어 테스트를 통과시키는 식으로 계층 규칙을 깨지 않는다.
4. 동작 테스트가 통과하는 동안 domain·use case·adapter 배치를 정리하고 의존성 검사를 실행한다. 오류·취소·권한·저장 원자성을 함께 보존한다.
5. 변경 경로에 맞는 통합·계약 검사를 통과한 뒤 구현 단위를 닫는다. 이행 단계의 최종 diff에서 필요한 제품 gate를 한 번 실행하고 작업 소유 자원을 정리한다.

| 검증 계층 | Ariadne에서 검증할 결과 | 경계와 실행 방식 |
| --- | --- | --- |
| Domain 단위 | noisy commit 필터 순서, review freshness, 필수 문맥 예산 | 순수 입력/결과. DB·SDK·프로세스 없이 실행 |
| Application | scope·revision 전달, 계산 실패 후 미게시, 취소 전파 | 포트의 결과·부수효과를 검사. 내부 함수 호출 순서를 그대로 복제하지 않음 |
| Adapter 계약 | 동일 repository/계산 계약의 구현별 정상·오류·상한 | 참조/실제 adapter에 같은 계약 사례 적용. 기능이 다른 DB 조합을 동등하다고 가정하지 않음 |
| 저장 통합 | Memory 예약 세션, Code stale 게시·savepoint, 재시도·부분 실패 | 실제 SQLite 및 작업 전용 Podman PostgreSQL/vector. mock으로 원자성 증명 금지 |
| 제품 계약 | CLI exit/cwd, HTTP/MCP schema·권한, 설치·선택 모듈 | 기존 클라이언트·진입점과 결과를 비교 |
| 아키텍처 | 잘못된 import·미등록 소스·순환 의존 거절 | 허용 사례와 위반 fixture를 함께 검사하고 CI 필수 gate에 연결 |

도메인 테스트를 위해 DB를 띄우거나 모든 사례를 E2E로 만들지 않는다. 반대로 단위 테스트만 통과하고 실제 DB 경합·프로세스 종료를 검증했다고 보고하지 않는다. 외부 시스템·시간·실패 조건을 격리할 때 테스트 대역을 쓰되 실제 통합 검사가 필요한 보장을 구분한다. 새 adapter는 적합성 검사를, 새 use case는 업무 결과와 실패 경로를 포함해야 완료다.

| 예정 파일 또는 기존 수정 대상 | 역할·수정 이유 |
| --- | --- |
| `runtime/go/go.mod`, `go.sum`, `cmd/Ariadne/main.go` | 고정 Go dependency와 단일 CLI 진입점 |
| `runtime/go/internal/composition/{modules,lifecycle}.go` | 명시 module 등록·공유 자원 시작/종료·부분 실패 정리 |
| `runtime/go/internal/code/application/cochange.go` | 계산 포트, 숫자 ID 변환, 결과 정책 소유 |
| `runtime/go/internal/platform/computeprocess/{runner,protocol}.go`와 `_test.go` | framing·bounded I/O·context·종료와 상한 시험 |
| `runtime/rust/Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` | workspace와 toolchain 고정 |
| `runtime/rust/crates/ariadne-compute/Cargo.toml`, `src/{main,lib,cochange}.rs` | 프로토콜 entrypoint·순수 집계·단위 시험 |
| `contracts/compute/v1/{request,response}.schema.json`, `fixtures/` | 양 언어 동일 정상/거절 bytes·digest·version 계약 |
| `tools/build.go`, `tools/build_test.go` | 선택 모듈 빌드·작업별 산출물·manifest 패키징 |
| `runtime/go/internal/code/application/index.go`, `adapters/sqlite/index.go` | G4에서 준비 결과 검증과 기존 head 비교·transaction/savepoint를 구현. G2에서는 생성하지 않음 |
| `packages/code/src/application/indexing/index-project.ts`, `ports.ts`, `composition/indexing.ts`, `infrastructure/sqlite/indexing.ts` | 전환 비교의 기존 계약 기준으로 보존. G2에서 Rust 연결을 위해 수정하지 않음 |
| `architecture-map.json`, package maps 및 `tests/module-boundaries.test.mjs` | Go/Rust/새 도구 누락 탐지와 import/호출 경계 검사 |
| `.github/workflows/verify.yml` 및 보안 workflow | 기존 Node gate 유지, 해당 단계에서 Go/Rust·혼합 버전·지원 플랫폼 gate 추가 |
| `.gitignore`, README 네 언어, `docs/consolidation.md`, `docs/architecture.md` | 실제 생성 산출물·설치 요구·지원 범위가 바뀌는 단계에서 함께 갱신 |

언어별 검증은 예정된 Go test/vet/race, Cargo test/fmt/clippy와 schema fixture 적합성 검사다. 제품의 기존 `npm run verify` 및 Memory DB/vector·MCP CI는 해당 owner가 이행 완료되기 전까지 제거하지 않는다. 보안 workflow의 지원 언어를 확인하고 Rust 의존성/소스 검사 도구를 선택한다. 기존 CodeQL 이름만 남겼다고 Rust까지 검사됐다고 보고하지 않는다. 새로운 toolchain·scanner 설치는 구현 단계의 명시된 준비 작업이다.

DB·브로커 통합 검증은 **Podman**을 사용한다. Docker Desktop으로 전환하지 않는다. 기존 Podman machine/context/default/desktop-linux 설정은 삭제하지 않는다. 작업별 container·network·volume 이름을 부여하고 준비 전 기존 자원 목록을 확인한다. 서비스가 필요 없는 순수 계약 검사는 로컬에서 수행한다. macOS/Windows native 종료 검증을 Linux container 결과로 대신하지 않는다.

### 자원 비교와 채택 기준

G0에서 실제 대표 입력 snapshot과 digest를 고정하고, 기본 범위와 한도 경계 입력을 비교한다. 같은 하드웨어·버전·embedding provider·모델·cache 상태에서 참조/Go/Rust를 비교한다. 실제 workload가 아직 없으므로 임의 QPS나 파일 수를 운영 요구로 쓰지 않는다.

측정값은 cold/warm 시작, end-to-end wall time와 CPU, p50/p95, 전체 프로세스 peak RSS, 입력/출력 bytes, 설치/압축/모델 용량, 테스트·빌드 시간이다. 프로세스 RSS 합계에는 공유 page가 중복될 수 있음을 표시하고, Linux cgroup peak와 OS별 측정법을 함께 기록한다. Rust 커널 시간만 비교하지 않고 직렬화·시작·대기·결과 적용까지 포함한다. 모델 토큰/비용은 별도 지표다.

첫 실험은 고정 fixture에서 결과 차이 0건, 보안/취소 시나리오 통과가 필수다. 이후 동일 입력의 짝지은 반복 측정으로 실행 편차와 성능·메모리 차이를 기록한다. 운영 예산이 미정이면 승패 기준을 사후에 고르지 않고 측정 전 비교 목적과 허용 회귀를 기록한다. 이 기준을 정하기 전에는 실험 backend만 제공하고 기본값은 유지한다. 이득이 없으면 Rust 계약 실험을 종료하거나 보류하며 Rust 사용량을 늘리는 것을 성공으로 삼지 않는다.

### 작업 자원 정리

후속 빌드의 `CARGO_TARGET_DIR`, `GOCACHE`, 임시 cwd와 로그는 실행 ID가 있는 전용 경로에 둔다. 공유 module/download cache와 기존 의존성은 자동 삭제하지 않는다. 검증 요약·exit code·실패 재현 fixture를 기존 private handoff에 보존한 뒤 이번 실행 소유의 불필요한 출력만 삭제한다. cleanup은 프로세스 종료 확인 후 수행한다. 정리 실패·남은 PID/경로·용량은 보고하고 전체 prune을 사용하지 않는다. `.parallax`, `.akasha`, 원본 DB/모델, 기존 컨테이너는 검사 없이 정리하지 않는다.

## 11. 시나리오와 결정 추적

아래는 설계에서 도출한 시험 계획이며 사용자 승인된 별도 정책이나 실제 통과 결과가 아니다. 기존 테스트는 참조 근거이고 새 Go/Rust 검증은 모두 미실행이다.

| ID / 결정 | 조건·행동 | 기대 결과와 검증 계층 |
| --- | --- | --- |
| GR-S01 / D01,D05 | core+ontology만 설치·실행 | Cargo/Node/DB/engine 미시작이라는 최종 목표를 clean 패키지 smoke로 검증. 과도기는 runtime 요구 별도 표시 |
| GR-S02 / D02,D04 | 중복·제외 파일·26파일 noisy commit·빈 이력·임계값 경계 | 필터 순서·빈도·양방향 관계가 TS 기준과 동일. 기존 `co-change.test.ts` + 공통 fixture |
| GR-S03 / D04,D05 | Unicode 정규화 동등 이름·등장 순서·locale·0.625 반올림 경계 | stable-sort tie·provenance bytes·relation ID·hash 차이 탐지. 차이가 남으면 Code cutover 금지 |
| GR-S04 / D03,D06 | oversized length·잘린/중복 frame·unknown field·wrong digest/version | bounded parse 오류, DB 게시/자동 fallback 없음. 양 언어 protocol 검사 |
| GR-S05 / D03 | 계산 중 cancel·deadline·stderr flood·stdout truncation·panic | late response 폐기, exit/pipe/goroutine 회수, runner 상한 보존. subprocess 통합 검사 |
| GR-S06 / D03 | 부모 강제 종료, EOF 수신, 종료를 무시하는 시험 엔진 | 정상 엔진 종료 확인. 종료 실패는 잔여 PID와 격리 상태 보고, 완료로 표시 금지 |
| GR-S07 / D02,D06 | 같은 org의 다른 scope 또는 다른 org 입력 | 기존 authorization boundary에서 거절, 계산 입력/결과·존재 정보 노출 없음. Memory API/MCP 계약 검사 |
| GR-S08 / D02,D05 | 계산 중 다른 Code writer 게시 | snapshot/head 충돌로 stale 게시 거절, 원본 유지. `co-change-index`, `incremental-index-oracle` 근거의 DB 통합 검사 |
| GR-S09 / D03,D05 | host와 engine version/hash 불일치·바이너리 누락 | 실행/입력 전송 전 거절, 다른 PATH 엔진 자동 사용 없음. 패키지 통합 검사 |
| GR-S10 / D05 | 새 writer 준비 중 실패·cutover 뒤 rollback | 구 writer/새 writer 동시 개방 없음, 데이터 가독성·backup 복원 확인. owner별 Podman 검사 |
| GR-S11 / D05 | 기존 Node CLI·hook·MCP·JS import 호출 | cwd/env/exit와 tool schema/export 보존. 기존 `product-cli`, `product-mcp`, public-exports와 golden 비교 |
| GR-S12 / D06 | UI `/source` 요청 또는 engine payload로 파일 경로 주입 | 410 유지·엔진의 파일 읽기 기능 없음. 기존 UI 계약 및 wire 거절 검사 |
| GR-S13 / D07 | 같은 입력의 TS/Go/Rust 자원 비교 | 결과·품질 먼저 통과, 전체 비용 기록, 손해인 backend 기본 전환 금지 |
| GR-S14 / D08 | 다중 binding 조립 실패·캐시 장애·지원하지 않는 transaction 조합 | 기존 설계의 시작 거절·역순 close·권한 fail-closed 유지. 해당 adapter 구현 시 검사 |
| GR-S15 / D03,D07 | 동시 요청·취소·runner 정리 실패 | slot 한도, BUSY, 정리 실패 runner 격리, queue 무한 증가 없음. race/자원 수명 검사 |
| GR-S16 / D09 | domain에 DB/exec import, 다른 모듈 repository 접근, 순환 import, 새 미등록 소스 추가 | 아키텍처 gate 실패. 위반 제거 후 정상 모듈이 통과하며 실제 검사기는 G0/G1에서 구현 |
| GR-S17 / D09 | 새 use case·adapter 구현 또는 기존 동작 이식 | 기대 동작 실패 확인→최소 구현 통과→경계 검사→관련 통합 검사 근거를 남김. 기존 정책 위반은 호환 목표와 분리 |

## 12. 미확인 사항과 다음 작업

이번 설계의 다음 구현 단위는 G0의 계약 fixture와 측정 baseline이다. 아래 기술 선택은 조사·실험 gate이며 사용자의 기존 정책을 다시 질문할 사유가 아니다.

- Go MCP SDK의 존재는 확인했지만 현 HTTP/MCP의 OAuth·tool schema·session·오류와의 동등성은 미검증이다.
- SQLite driver/`sqlite-vec`와 transformers 대체 adapter, TS parser 대체 여부는 선정 전이다. native dependency·라이선스·모델 출력 동등성·플랫폼 검사가 끝나기 전 해당 owner의 Node 제거를 약속하지 않는다.
- Go/Rust 실제 toolchain pin, release runner 가용성, hard RSS 상한과 운영 SLO는 G0의 산출물이다. compiler 설치나 CI 권한 변경은 이번에 수행하지 않는다.
- 첫 Rust 집계가 작아서 실익이 없을 수 있다. 다른 계산을 추가하려면 실제 profile 근거와 bounded input 계약이 필요하다.

설계 문서 검증 범위는 실제 코드/기존 목표 대조, 대안 검토, 시나리오 연결, 독립 리뷰, 상대 링크·REQ 형식·diff 확인이다. Go/Rust 빌드·성능·운영 검증과 동일한 상태로 보고하지 않는다.

독립 리뷰에서 G2의 중계 경계, EOF 종료 순서, stable-sort 동률과 소수점 provenance, 임베딩 전처리 누락을 보완했다. 최종 검토에는 미해결 Blocker/Major가 없으며 목표 설계와 G0 준비로 진행할 수 있다는 판정을 받았다. 실제 프로세스 종료·성능·native adapter·운영 cutover 검증은 여전히 남아 있다.

후속 요청으로 GR-D09, §4.1–4.3, §10의 TDD 순서, GR-S16–17을 명시했다. 이는 기존 아키텍처 요구를 구체화한 문서 보완이며 초기 독립 리뷰 이후 추가됐다. 이 부분은 기존 owner·의존성 규칙과 문서 수준에서 대조했으며 아직 Go/Rust 경계 검사나 TDD 실행 근거는 없다.

## 13. 공식 자료와 해석 범위

2026-11-09 확인. 버전은 G0에서 실제 고정하며 공식 문서의 현재 예제가 프로젝트에서 실행됐다는 뜻은 아니다.

- [Go os/exec](https://pkg.go.dev/os/exec): shell을 거치지 않는 실행과 `CommandContext`, `Wait`, `WaitDelay`의 수명 계약. Context7의 `/golang/go` 원문 대조에서도 직계 자식과 pipe 처리이며 전체 process tree 보장이 아님을 확인했다.
- [Cargo workspace](https://doc.rust-lang.org/cargo/reference/workspaces.html): workspace 단위 lockfile과 기본 target directory. 작업별 target 경로와 lockfile 정책 설계의 근거다.
- [Rust platform support](https://doc.rust-lang.org/rustc/platform-support.html): compiler target 지원과 Ariadne 패키지의 실제 플랫폼 검증은 구분한다.
- [공식 Go MCP SDK](https://github.com/modelcontextprotocol/go-sdk): Go 서버/클라이언트 구현 후보. 현재 Ariadne 인증·전송 계약의 자동 호환을 보장하지 않는다.

EGM의 문서 구조와 pstack의 경계·대안 검토를 적용했다. 사용자가 이미 설계를 요청한 범위는 반복 승인 인터뷰 없이 문서화하며, 정책·공개 계약을 바꾸는 미결정 사항은 구현 전에 분리한다.
