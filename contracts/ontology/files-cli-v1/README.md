# G1b Node 파일·CLI 계약

Node 24.22.2의 기존 `modules/ontology/cli.mjs`를 실제 자식 프로세스로
실행한 43개 결과와 Core reader의 12개 관측을 고정한다. CLI는 별도 임시
프로젝트 cwd에서 실행한다. 기존 36개 순수 ontology 골든은 변경하지 않는다.

```sh
node scripts/ontology-files-cli-goldens.mjs
# 원본 계약의 의도된 변경을 검토할 때만 재생성
node scripts/ontology-files-cli-goldens.mjs --write
```

`cases.json`이 실제 파일 내용과 argv를 소유하고 `expected.json`은 stdout,
stderr, exit와 원본·입력·oracle SHA-256 및 Node/ICU/Unicode를 고정한다.
합성 GitHub token 입력의 첫 ASCII 글자는 JSON Unicode escape로 저장한다.
JSON을 읽은 실제 runtime 입력과 scrub 관측은 그대로이며 scanner 예외는 추가하지 않는다.

Go `TestNodeFilesCLIGoldens`는 같은 파일을 만든 뒤 composition 진입점의
전체 결과를 byte 단위로 비교한다. `TestActualNodeReaderGoldens`는 reader의
bytes·hash·오류를 대조한다. 별도 실제 filesystem 검사에는 executable text,
UTF-8/BOM/NUL/크기와 symlink·FIFO·socket 및 root/ancestor/leaf 교체와 FD 정리가 있다.

UTF-16 경로 세 개는 각각 high surrogate, low surrogate, U+FFFD를 포함한다.
실제 파일 I/O는 동일한 U+FFFD 이름에 접근하지만 fingerprint와 결과의 세
원본 경로는 서로 다르다. JSON 출력에는 lone surrogate와 `<>&` 및 U+2028/2029를 유지한다.
OS wrapper가 만드는 원시 errno 문구는 플랫폼별일 수 있다. 이 골든은 해당 환경의
권한·디스크 오류문까지 모든 플랫폼에서 동일하다고 주장하지 않는다.

`dependency-provenance.json`은 공개 `golang.org/x/sys` v0.50.0의 module
checksum과 upstream commit, 실제 사용 API를 포함한 공식 source bytes 및
license를 고정한다. [BSD license](x-sys-LICENSE.txt)를 함께 보존한다.
Darwin/Linux 외 플랫폼은 reader가 명시적으로 실패한다.

로컬 macOS와 실제 Linux CI는 별도 근거다. 기본 Node 제품은 유지하며,
이 단위는 기본 전환 또는 성능 측정 및 전체 G1 완료가 아니다.
