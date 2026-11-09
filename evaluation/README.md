# 평가 도구의 제어군 확인

알려진 오답과 정답을 넣어 검사 도구가 그 차이를 구별하는지 확인한다. 모델·네트워크를 호출하지 않는다.
이 제어군 통과는 **도구의 자가검증**이며, P8 Stage 0·하네스 on/off·양방향 handoff 품질을 측정한 결과가 아니다.
기존 P8의 P1 원문 프롬프트 3개와 평가 행렬은 변경하지 않는다.

## 실행

```sh
node scripts/verify-evaluation.mjs
node --test tests/evaluation.test.mjs
```

첫 명령은 `verified_fixture_controls`와 `p8_quality: not_measured`를 반환해야 한다.
세 제어군의 baseline은 각각 지정한 비교 ID에서만 실패하고, reference는 총 11개 결과 비교를 통과해야 한다.
예상 실패 이외의 차이나 실행 오류가 있으면 nonzero로 종료하며 성공 보고서를 출력하지 않는다.

| 제어군 | 의도한 차이 | 확인하는 범위 |
|---|---|---|
| unread-count | 읽은 메시지를 제외하지 않는 baseline | 빈 배열·혼합 상태·전부 읽은 상태의 반환값 |
| zero-limit | 명시적 0을 기본값으로 바꾸는 baseline | 생략·null·0·다른 숫자의 반환값 |
| label-catalog | 라벨의 대소문자를 구분하는 baseline | 여러 파일의 helper, 공백·대소문자·원래 순서 |

## 동결 범위

`suite.json`은 유일한 입력 원본이다. 각 제어군은 유기적인 작업 요청, 파일 맵, reference 변경,
함수 진입점과 export 이름, 고정 JSON 인자·기대값 및 baseline 실패 ID를 포함한다.
`suite.sha256`은 파일의 정확한 바이트를 동결한다. 수정한 suite를 과거 hash로 검사하면 실패한다.
입력을 의도적으로 바꿀 때만 hash도 갱신하고 제어군 검사를 다시 실행한다.

```sh
shasum -a 256 evaluation/suite.json > evaluation/suite.sha256
node scripts/verify-evaluation.mjs
```

이 hash는 검사기 코드·CLI·모델·실제 실행 행렬을 동결하지 않는다. P8 AC1 전체 충족이나 과거 모델 결과의 재사용 근거로 사용하지 않는다.
실제 평가를 시작할 때는 그 실행이 사용할 모든 입력·검사기·CLI·모델과 판정 기준을 별도로 고정해야 한다.

## 실패와 실행 오류

baseline은 모듈과 함수를 정상 실행한 뒤, 고정 기대값과 **결과만** 달라야 한다.
worker 정상 종료는 exit 0이며 비교 불일치는 반환 데이터로만 전달한다. JSON을 출력했더라도 이후 실행 오류로 종료되면 인증하지 않는다.
문법 오류·누락된 export·호출 예외·timeout·불완전한 worker 응답은 이번 신뢰 fixture의 `INVALID`이며 예상 오답으로 인증하지 않는다.
예를 들어 baseline 함수가 값을 잘못 반환하는 대신 예외를 던지면 검사 도구 전체가 실패해야 한다.

이 분류는 도구 자가검증에 한정된다. 향후 실제 모델 산출물의 문법 오류·예외·예산 초과는 해당 P8 계약에 따라 `FAIL`로 채점한다.
모델의 실패를 `INVALID`로 빼면 품질을 과대평가하므로 이 자가검증 결과를 일반 agent grader로 쓰지 않는다.

부모가 비교 코드를 소유하고 baseline과 reference를 별도 프로세스로 실행한다. 각 실행은 5초와 1 MiB 출력 상한을 가지며,
쉘을 사용하지 않는다. 종료 뒤 이번 실행이 만든 임시 작업 공간만 정리한다.
이 프로세스 분리는 네트워크·비밀 접근을 차단하는 sandbox가 아니다. 저장소에서 관리하는 신뢰 제어군만 실행한다.

반환값이 같은 내부 리팩터링, 실제 지침 발동·준수, 승인 경계, REQ 증거와 handoff 보존은 이 11개 비교로 인증하지 않는다.
유료 capability smoke, 실행 환경 격리, 실제 Stage 0와 held-out 평가는 기존 P8에 남아 있다.

## 기록된 실행 비교

기존 제어군 실행과 독립적으로, 이미 수집한 실행 기록의 비교 가능성과 비용을 검사한다. 모델이나 명령을 실행하지 않는다.

```sh
node bin/Ariadne.mjs eval compare --file evaluation/comparison-example.json
```

`comparison-example.json`은 합성 예제다. 실제 품질·사용량 측정 자료로 사용하지 않는다. 입력은 root 안의 상대 경로 JSON 파일이며 크기 상한은 1 MiB다. `--root`를 생략하면 현재 디렉터리를 사용한다. 결과의 `source.sha256`은 읽은 원본 바이트를 식별한다.

| 입력 | 계약 |
| --- | --- |
| schema_version / baseline / candidate | `1` / `base` / `selected` 고정 |
| runs | 최대 1000개. case_id와 variant 조합은 중복 불가 |
| case_id | 하나의 과제·반복 회차. 반복 실험은 새 ID 사용 |
| identity | input_sha256, verifier_sha256, model, effort, environment_sha256. 누락·null은 비교 불가이며 같은 누락끼리 일치하지 않음 |
| harness_sha256 | variant 안에서는 동일하고 양쪽 variant는 다른 SHA-256 |
| attempts | 1~100개. outcome은 pass/fail/error/unknown. pass는 마지막 시도에서만 허용 |
| evidence_sha256 | pass에 필요한 보고된 검증 영수증 hash. 독립적인 실행 인증은 아님 |
| input_tokens / output_tokens | 각 시도의 음이 아닌 안전 정수 또는 null/누락 |
| cost_usd | 관측된 음이 아닌 유한 숫자 또는 null/누락. 토큰에서 임의 가격 환산하지 않음 |

예상하지 않은 필드, 잘못된 숫자·hash·중복 기록은 exit 2로 실패하고 stdout을 남기지 않는다. 유효하지만 비교 조건이 부족한 기록은 exit 0 보고서의 `eligibility.comparable=false`와 사유로 나타낸다. 보고서 생성 성공은 실험 성공이 아니다.

`variants`는 오류·실패를 포함한 전체 사례와 모든 시도의 비용을 집계한다. 필드별 관측 범위는 `coverage`다. 하나라도 사용량이 없으면 해당 전체 지표를 null로 유지한다. 성공 0건의 성공당 비용도 null이다. 비용에는 JavaScript 부동소수 반올림 오차가 있을 수 있다. 토큰 입력·합계는 안전 정수 범위를 벗어나면 거절한다.

`paired.reported_regressions`는 조건이 일치하는 사례에서 기준선 pass가 후보의 비pass로 바뀐 경우다. 전체 비교 조건이 부족하면 `descriptive`는 null이다. 입력과 영수증은 사용자가 제공한 기록이며, 같은 hash만으로 인과성·통계적 우월성·실제 검증 실행을 보장하지 않는다. 원본 기법과 적용 판단은 [출처 검토](../docs/harness-engineering-adoption.md)를 따른다.


## 선택적 기억 하나의 비교

```sh
node bin/Ariadne.mjs eval memory-ablation --file evaluation/memory-ablation-example.json
```

예제는 합성 자료이며 실제 모델 효용을 측정하지 않는다. 모델·명령·DB를 실행하지 않고 1 MiB 이하의 기존 JSON만 읽는다. 기존 `eval compare` v1 계약은 유지한다.

`target`은 선택적 기억의 ID·내용 SHA-256이다. `conditions.base`는 이를 제외하고 `selected`는 정확히 하나만 추가한다. 나머지 필수/선택 기억의 순서·해시, 조직·scope 및 `configuration_sha256`은 같아야 한다. 필수 기억은 제외 대상이 될 수 없다. 설정 해시는 기억 선택 외의 모든 하네스 설정을 식별해야 한다.

`plan`은 예정 case와 입력·검사기·모델·effort·환경 identity, 시도 상한, `pass_or_max_attempts` 중단 규칙, 조건 해시를 고정한다. 최대 500 cases와 시행당 100 attempts를 허용한다. 조건·계획 해시는 `memoryConditionDigest`와 `memoryAblationPlanDigest`에 SHA-256 함수를 제공해 계산한다. 일반 JSON 바이트 해시가 아니라 키를 정렬한 정규 표현의 해시다. 각 run의 `harness_sha256`은 해당 조건 해시여야 한다.

비교 입력은 기존 v1 `comparison`에 넣는다. 예정 실행 누락이나 성공 전 조기 종료는 비교 불충분으로 표시한다. 추가 case·다른 조건 해시·상한 초과는 입력 오류다. 해시는 자료 연결만 확인하며 사전 등록이나 실행 사실을 인증하지 않는다.

`experiment_costs`의 `construction`, `verification`, `maintenance`는 각각 input_tokens/output_tokens/cost_usd를 숫자 또는 null로 보고한다. 준비 비용은 실험 전체에 한 번만 더한다. `recorded_totals`는 보고된 시도와 준비 비용의 합계다. 계획 실행이 누락되거나 미완료이면 `experiment_totals`는 null이며 `execution_coverage`에 그 범위를 표시한다. 비용 누락도 0으로 채우지 않는다.

최상위 `eligibility`가 계획 조건까지 포함한 판정이다. 내부 `comparison`은 기존 v1 판정을 보존한다. `observations`의 improvement/regression/unchanged/unknown은 보고된 pass 전환일 뿐 인과성·통계적 우월성·인기 점수가 아니다. 실제 채택 판단에는 독립 과제와 검증 근거가 필요하다. 상세 계약은 [기억 재사용](../docs/memory-reuse.md), 회귀 검사는 [memory-ablation.test.mjs](../tests/memory-ablation.test.mjs)에 있다.
