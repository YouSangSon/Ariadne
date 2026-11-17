# Core product Node 계약

`cases.json`은 문자열 명령·인자, 순서 있는 모듈 선택, 문자열 환경과 주입한 실행/보고 결과를 입력으로 고정한다. `expected.json`은 Node 24.22.2에서 실제 `commandPlan`, `selectModules`, `lifecycleEnvironment`, `lifecycleSteps`, `runProduct` export를 호출해 생성했다. Go 결과로 기대값을 만들지 않는다.

## 보존 범위와 버그 수정

G1c1은 Go 순수 정책과 포트 기반 순차 조율을 추가한다. Node 제품 런처가 계속 기본값이다. Go의 실제 프로세스 실행, signal·취소, CLI, Context·Evaluation·Wiki·Memory·Code 내부와 데이터 저장은 이 단위의 범위가 아니다.

Node의 기존 세 명령 lookup은 `toString`, `constructor`, `__proto__`를 상속 속성으로 읽었다. eval/knowledge가 존재하지 않는 스크립트 경로를 만들고 memory가 일반 CLI 대신 잘못된 서비스 경로를 선택하던 버그다. `Object.hasOwn`으로 세 lookup만 수정했다. eval/knowledge의 기존 오류 문구를 유지하고 memory의 알 수 없는 이름은 기존 일반 CLI로 전달한다. 이 9개 회귀는 수정 전 모두 실패했다. 이 버그를 이식할 계약으로 고정하지 않는다. 현재 golden은 그 수정을 포함한 실제 Node export의 결과다.

## 입력과 결과 계약

- `CommandPlan`은 help의 인자 부재와 process의 빈 인자 배열을 구분한다. `Plan.CWD == nil`은 호출자 디렉터리 상속, `*CWD == ""`는 checkout root다. `Module`은 기존 launcher의 build 확인 대상이며 `InstallRoot`는 install 인자 삽입 표시다. Go는 실행하거나 경로를 해석하지 않는다.
- `SelectModules(args, defaults)`의 defaults는 호출자가 명시한다. 빈 args는 defaults의 순서를 유지하며 중복만 제거한다. 빈 defaults와 임의의 default 문자열도 보존한다. 명시한 `--modules`는 정확한 네 이름만 허용하고 중복·공백·빈 항목을 거절하며 core를 앞에 둔다. 제품 기본값 네 모듈과 source verifier 기본값 core/ontology는 별개다.
- lifecycle과 application의 modules는 `SelectModules` 결과처럼 중복이 없는 순서 있는 선택이다. fixture의 JS Set 투영도 같은 입력을 사용한다. 패키지 실행은 선택 순서와 별개로 memory 다음 code다. setup은 모든 ci 뒤 모든 build를 수행한다. test/verify는 source verify가 먼저다. 알 수 없는 action은 빈 step 계획이며 실제 action 허용 검사는 기존 script가 소유한다.
- 환경은 복사한다. 빈 값과 일반 키를 유지하고 ONNX 설치 생략 값을 덮어쓴다. test/verify에서만 실제 9개 guarded 키를 제거한다. 실제 OS 환경이나 credential을 읽지 않는다.
- `RunProduct`는 시작 보고 → 순차 실행 → 모든 status가 0이면 완료 보고를 수행한다. 첫 nonzero를 그대로 반환하고 뒤 실행·완료 보고를 생략한다. 실행/보고 오류는 변환하지 않고 즉시 반환한다. Go의 오류 반환과 함께 나오는 정수는 성공/프로세스 status로 해석하지 않는다.
- Go 입력은 실제 argv/env의 문자열 타입을 대상으로 한다. JavaScript의 임의 값 coercion, 객체 identity, prototype 함수 값이나 범용 JS 호환을 주장하지 않는다. Plan/Step의 JSON 표현은 테스트에서만 투영한다.

## 재현

```sh
node scripts/product-node-goldens.mjs
node --test tests/product-node-contracts.test.mjs
# 승인된 계약 변경 뒤에만 golden을 재생성한다.
node scripts/product-node-goldens.mjs --write
```

provenance에는 실제 Node/V8/Unicode 버전, 원본 export 및 launcher/script SHA-256, 입력 원문 SHA-256과 oracle script SHA-256을 저장한다. 검사 명령은 쓰지 않고 현재 원본 실행 결과·출처를 golden과 비교한다. 결과·이벤트·출처 변조를 거절하는 제어 테스트도 포함한다. 포트 이벤트는 프로세스 실행, 배포나 취소 검증의 근거가 아니다.
