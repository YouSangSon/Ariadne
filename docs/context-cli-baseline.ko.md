# G0 Context CLI 자원 기준선

[Go + Rust 전환 설계의 자원 비교](go-rust-runtime-design.ko.md#자원-비교와-채택-기준) 중 macOS 로컬 `context` 두 경로를 비교한다. 같은 출력을 만드는 실험 Go 실행 파일과 공개 Node 런처의 호출 비용을 관측한다. 이 결과의 범위는 아래 고정 입력과 이 호스트다. 허용 회귀폭과 운영 예산은 후속 채택 검증의 입력이다. [요구사항](../.harness/reqs/context-cli-baseline.yaml)

## 고정 입력과 성공 조건

`0808fc65168fbef66ec534d41e3f03d2b7236892`의 Git blob 세 개를 상대 경로 그대로 임시 프로젝트에 복사한다. REQ는 Context 파일 연결 및 CLI 이식 작업의 요구사항이다. 결정 기록과 본문으로 선택할 Context 스킬을 같은 커밋에서 가져온다. 이 입력의 파일 내용은 총 9,326바이트다.

| 경로 | 바이트 | SHA-256 |
| --- | ---: | --- |
| `.harness/reqs/go-context-files.yaml` | 4,715 | `40cfaaab362b4e1023e496364ffcc8e2231e42ca6759457b75e571462fbb8f36` |
| `.harness/decisions.md` | 978 | `1f1ab23f4875116ec737d1bf87ae9d2483d1f8274076cc41bbbf168bcf9465c1` |
| `skills/context/SKILL.md` | 3,633 | `c20cd564a8de39c1a54cca1db58a287f7c86dff58aa3d6e95f030052a1483692` |

임시 프로젝트를 호출 디렉터리로 사용한다. 두 경우 모두 `--req go-context-files`와 `--skill context@<스킬 원본 SHA-256>`을 전달한다. 기본 `standard`는 `--budget`을 생략해 실제 기본 예산으로 팩을 만든다. 같은 입력에 `--budget brief`를 추가하면 필수 문맥이 4,000 UTF-16 단위 한도를 넘는다.

| 경우 | 종료값 | stdout | stderr |
| --- | ---: | --- | --- |
| 기본 `standard` | 0 | 9,656바이트, 6,811 UTF-16 단위. SHA-256 `231bd563930759bce8ad8b7ed4f61e68c17438735b92620a9423c07d7cca1dbd` | 0바이트 |
| `brief` 예산 초과 | 1 | 0바이트 | 129바이트. SHA-256 `e205f74d84ff4db534f6c1981a11dc7fd43107156e4deea1b5ebd71f91614693` |

먼저 따로 만든 프로젝트에서 실제 양쪽 CLI의 종료값과 출력 SHA-256을 위 기대값에 대조하고 stdout·stderr를 바이트 단위로 비교한다. 측정 구간에서도 매 호출 결과의 바이트와 종료값을 사전 비교 결과에 대조한다. 예산 초과로 인한 종료값 1은 이 경우의 기대 동작이다. 출력 차이, 예상 밖 종료 또는 타임아웃이 한 건이라도 나오면 그 실행의 기준선 집계를 중단한다.

## 측정 절차

Node는 `node bin/Ariadne.mjs context …`로 호출한다. 이 런처가 실제 Context 작업을 하는 Node 자식을 시작하고 종료를 기다린다. Go는 한 번 빌드한 non-race `runtime/go/cmd/Ariadne` 실행 파일에 `context …`를 전달한다. 각 호출은 새 프로세스다. Python 표준 라이브러리 도구가 임시 파일로 표준 출력을 받고, `PATH=/usr/bin:/bin`, `LC_ALL=C` 및 임시 `HOME`·`TMPDIR`를 두 실행에 동일하게 제공한다.

사전 대조 뒤 경우별로 새 임시 프로젝트를 만들고 첫 호출을 양쪽에서 한 번씩 관측한다. `standard`는 Node가 먼저, `brief`는 Go가 먼저 실행된다. 캐시를 비우지 않고, 파일을 복사했으며 같은 바이너리로 사전 대조한 상태다. 첫 호출 값은 해당 임시 프로젝트의 시작 관측치다.

같은 두 프로젝트에서 경우별 예열 2쌍과 기록용 60쌍을 실행한다. 한 번에 명령 하나만 실행하며 쌍마다 Node·Go 실행 순서와 두 입력 경우의 순서를 번갈아 바꾼다. 첫 호출은 한 번의 관측값으로, 반복은 최근접 순위 방식(`ceil(n × p)`번째 작은 값)의 p50·p95와 최솟값·최댓값으로 기록한다. 빌드·버전 확인, 파일 복사, 결과 비교는 측정 구간 밖이다. 호스트 부하와 CPU idle은 별도로 관측하고 이상치를 빼지 않는다.

- Wall은 실행을 요청하기 직전부터 프로세스를 회수할 때까지의 경과 시간이다. 런처와 자식 실행, 임시 파일에 출력하는 비용이 들어간다.
- CPU는 macOS `wait4`가 돌려준 user와 system 시간의 합이다. 명령 프로세스와 명령이 회수한 자식의 시간이 들어간다.
- RSS는 같은 `wait4`의 `ru_maxrss` 바이트다. 명령 및 회수된 자식 각각의 최대 상주 메모리 중 가장 큰 값이다. 동시 프로세스 트리의 메모리 합계와 페이지 공유는 미측정이다. [XNU의 종료 시 자식 통계 합산](https://github.com/apple-oss-distributions/xnu/blob/xnu-11417.140.69/bsd/kern/kern_exit.c#L2280-L2289), [CPU 합산과 RSS 최댓값 처리](https://github.com/apple-oss-distributions/xnu/blob/xnu-11417.140.69/bsd/kern/kern_resource.c#L1538-L1548)

## 재현

이 문서의 측정 도구가 들어 있는 소스에서 실행한다. 저장소의 `.tool-versions`와 macOS C 컴파일러가 필요하다. 기존 Go 의존성을 전용 캐시에 준비한 뒤 오프라인으로 빌드한다.

```sh
scratch="$(mktemp -d)"
mkdir "$scratch/cache" "$scratch/modules" "$scratch/go-tmp" "$scratch/check" "$scratch/run"
export GOENV=off GOTOOLCHAIN=local GOFLAGS='' GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 CC=/usr/bin/clang
export GOCACHE="$scratch/cache" GOMODCACHE="$scratch/modules" GOTMPDIR="$scratch/go-tmp"
asdf exec go -C runtime/go mod download
GOPROXY=off asdf exec go -C runtime/go build -mod=readonly -trimpath -buildvcs=false -o "$scratch/Ariadne" ./cmd/Ariadne
node_binary="$(asdf which node)"
asdf exec go version -m "$scratch/Ariadne"
shasum -a 256 "$node_binary" "$scratch/Ariadne"
asdf exec python3 -B tools/measure_context_cli.py --node "$node_binary" --go "$scratch/Ariadne" --scratch "$scratch/check" --check
asdf exec python3 -B tools/measure_context_cli.py --node "$node_binary" --go "$scratch/Ariadne" --scratch "$scratch/run" > "$scratch/receipt.json"
```

영수증의 `preflight`, 첫 호출과 반복 원시값, `summary`를 확인한다. 결과를 보관한 뒤 프로세스 그룹의 종료와 작업 임시 경로를 확인하고 이 실행이 만든 파일을 정리한다.
