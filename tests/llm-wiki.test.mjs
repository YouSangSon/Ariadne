import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const MOD = join(dirname(fileURLToPath(import.meta.url)), '..', 'modules', 'llm-wiki')
const run = (script, args) => spawnSync(process.execPath, [join(MOD, script), ...args], { encoding: 'utf8' })

function makeFixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'harness-wiki-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const proj = join(base, 'proj')
  const vault = join(base, 'vault')
  mkdirSync(join(proj, '.harness', 'reqs'), { recursive: true })
  writeFileSync(join(proj, '.harness', 'decisions.md'), '- 2026-07-19: mjs 확장자 고정\n- 2026-07-20: 그래프는 파생물\n')
  writeFileSync(
    join(proj, '.harness', 'reqs', 'demo.yaml'),
    'metadata:\n  req_id: demo\n  title: 데모 요구\n  status: verified\n',
  )
  const wiki = join(vault, 'Projects', 'demo', 'Long', 'llm-wiki', 'wiki')
  mkdirSync(join(wiki, 'entities'), { recursive: true })
  mkdirSync(join(wiki, 'concepts'), { recursive: true })
  writeFileSync(join(wiki, 'entities', 'demo Project Hub.md'), '# demo Project Hub\n\n[[Core Idea]] 참조.\n')
  writeFileSync(join(wiki, 'concepts', 'Core Idea.md'), '# Core Idea\n\n[[demo Project Hub]]와 [[Missing Page]] 링크.\n')
  return { proj, vault }
}

const PROMOTE_ARGS = (f) => ['--root', f.proj, '--vault', f.vault, '--project', 'demo', '--date', '2026-07-20']

test('AC1: promote가 sources 페이지를 만들고 재실행은 변경 0', (t) => {
  const f = makeFixture(t)
  const r1 = run('promote.mjs', PROMOTE_ARGS(f))
  assert.equal(r1.status, 0, r1.stderr)
  const page = join(f.vault, 'Projects', 'demo', 'Long', 'llm-wiki', 'wiki', 'sources', '2026-07-20 demo harness sync.md')
  assert.ok(existsSync(page), '페이지 없음')
  const text = readFileSync(page, 'utf8')
  assert.ok(text.includes('mjs 확장자 고정') && text.includes('데모 요구'))
  const r2 = run('promote.mjs', PROMOTE_ARGS(f))
  assert.match(r2.stdout, /changed=0/, '멱등 실패')
})

test('규약: H1 == 파일명 (filename==H1==링크)', (t) => {
  const f = makeFixture(t)
  run('promote.mjs', PROMOTE_ARGS(f))
  const page = join(f.vault, 'Projects', 'demo', 'Long', 'llm-wiki', 'wiki', 'sources', '2026-07-20 demo harness sync.md')
  assert.equal(readFileSync(page, 'utf8').match(/^# (.+)$/m)[1], basename(page, '.md'))
})

test('AC3: 볼트로 가는 텍스트에 scrub 적용', (t) => {
  const f = makeFixture(t)
  writeFileSync(join(f.proj, '.harness', 'decisions.md'), '- 2026-07-20: 키는 sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 사용\n')
  run('promote.mjs', PROMOTE_ARGS(f))
  const page = readFileSync(
    join(f.vault, 'Projects', 'demo', 'Long', 'llm-wiki', 'wiki', 'sources', '2026-07-20 demo harness sync.md'),
    'utf8',
  )
  assert.ok(!page.includes('api03-aaaa'), '시크릿 유출')
  assert.ok(page.includes('[REDACTED_ANTHROPIC_KEY]'))
})

test('AC2: graph-index가 관계·미해결 링크를 추출해 인덱스를 전체 재생성한다', (t) => {
  const f = makeFixture(t)
  const r = run('graph-index.mjs', ['--vault', f.vault, '--project', 'demo'])
  assert.equal(r.status, 0, r.stderr)
  const idx = join(f.vault, 'Projects', 'demo', 'Long', 'llm-wiki', 'wiki', 'graphs', 'demo Ontology Index.md')
  assert.ok(existsSync(idx))
  const text = readFileSync(idx, 'utf8')
  assert.ok(text.includes('Core Idea → demo Project Hub'), `관계 누락: ${text}`)
  assert.ok(text.includes('Missing Page'), '미해결 링크 누락')
  assert.equal(text.match(/^# (.+)$/m)[1], 'demo Ontology Index')
})

test('파생 재생성: 원본 링크 삭제 후 재실행하면 인덱스에서 관계가 사라진다', (t) => {
  const f = makeFixture(t)
  run('graph-index.mjs', ['--vault', f.vault, '--project', 'demo'])
  writeFileSync(join(f.vault, 'Projects', 'demo', 'Long', 'llm-wiki', 'wiki', 'concepts', 'Core Idea.md'), '# Core Idea\n\n링크 없음.\n')
  run('graph-index.mjs', ['--vault', f.vault, '--project', 'demo'])
  const text = readFileSync(
    join(f.vault, 'Projects', 'demo', 'Long', 'llm-wiki', 'wiki', 'graphs', 'demo Ontology Index.md'),
    'utf8',
  )
  assert.ok(!text.includes('Core Idea → demo Project Hub'), '삭제된 관계 잔존 — 파생이 아니라 누적')
})

test('graph-index: 코드블록 안 [[링크]]는 무시한다', (t) => {
  const f = makeFixture(t)
  writeFileSync(
    join(f.vault, 'Projects', 'demo', 'Long', 'llm-wiki', 'wiki', 'concepts', 'Code Sample.md'),
    '# Code Sample\n\n```\n[[Fake Link]]\n```\n`[[Inline Fake]]`\n',
  )
  run('graph-index.mjs', ['--vault', f.vault, '--project', 'demo'])
  const text = readFileSync(
    join(f.vault, 'Projects', 'demo', 'Long', 'llm-wiki', 'wiki', 'graphs', 'demo Ontology Index.md'),
    'utf8',
  )
  assert.ok(!text.includes('Fake Link') && !text.includes('Inline Fake'), '코드블록 오탐')
})
