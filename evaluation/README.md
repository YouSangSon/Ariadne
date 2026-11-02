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
