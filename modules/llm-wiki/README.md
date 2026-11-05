# Ariadne llm-wiki (옵션 모듈)

`.harness/` 기록(decisions, handoff, verified REQ)을 Obsidian 볼트의 sources
페이지로 승격하고, 볼트 위키링크에서 온톨로지 인덱스를 파생 생성한다.

**단일 진실은 `.harness/`다** — 볼트 페이지는 그날의 스냅샷 승격본이고,
인덱스는 실행할 때 현재 볼트 위키링크를 기준으로 전체 재생성한다. 볼트가 바뀌면
인덱스는 다음 재생성 전까지 오래된 상태일 수 있다.

요구사항: Obsidian 볼트 경로만. 코어 동작에 필수 아님.

## 사용

```bash
# 1) 승격 — .harness 기록을 볼트 페이지 1장으로 (scrub 통과분만 기록)
node modules/llm-wiki/promote.mjs --vault ~/Desktop/obsidian --project <name>
#   옵션: --root <repo>(기본 cwd), --date YYYY-MM-DD(기본 오늘)

# 2) 인덱스 — 볼트 위키링크에서 "<name> Ontology Index" 재생성
node modules/llm-wiki/graph-index.mjs --vault ~/Desktop/obsidian --project <name>
```

산출물 위치: `<vault>/Projects/<name>/Long/llm-wiki/`.
규약: filename == H1 == 위키링크 (aliases 미사용 볼트 기준).

검증: `node --test tests/llm-wiki.test.mjs`
