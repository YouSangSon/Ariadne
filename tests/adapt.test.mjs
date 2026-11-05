import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const temporaryDirectories = []
after(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }) })

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')
const run = (script, args) =>
  spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8' })

const USER_CLAUDE = '# 내 프로젝트 규칙\n\n절대 지우면 안 되는 사용자 내용.\n'
const USER_AGENTS = '# 팀 규칙\n\n사용자 소유 섹션이다.\n'

function makeBrownfield({ withAgents = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-p5-'))
  temporaryDirectories.push(dir)
  writeFileSync(join(dir, 'CLAUDE.md'), USER_CLAUDE)
  if (withAgents) writeFileSync(join(dir, 'AGENTS.md'), USER_AGENTS)
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'a.js'), 'x\n'.repeat(40))
  return dir
}

const snapshot = (dir) =>
  JSON.stringify(
    readdirSync(dir, { recursive: true })
      .filter((f) => !String(f).startsWith('.harness'))
      .sort()
      .map((f) => {
        const p = join(dir, String(f))
        return [String(f), existsSync(p) && !readdirSync(dir).includes('x') ? tryRead(p) : '']
      }),
  )
const tryRead = (p) => {
  try { return readFileSync(p, 'utf8') } catch { return '(dir)' }
}

test('AC1: 마커 블록 생성 + 마커 밖 사용자 내용 절대 보존', () => {
  const dir = makeBrownfield()
  const r = run('adapt-apply.mjs', ['--target', dir, '--verify-cmd', 'npm test'])
  assert.equal(r.status, 0, r.stderr)
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  assert.ok(agents.includes('<!-- harness:begin'), '마커 없음')
  assert.ok(agents.includes('<!-- harness:end -->'))
  assert.ok(agents.includes('사용자 소유 섹션이다'), '사용자 내용 유실')
  assert.ok(agents.includes('npm test'))
})

test('AC2: 기존 CLAUDE.md 백업 + 최상단 @AGENTS.md 삽입', () => {
  const dir = makeBrownfield()
  run('adapt-apply.mjs', ['--target', dir, '--verify-cmd', 'npm test'])
  const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')
  assert.equal(claude.split('\n')[0], '@AGENTS.md')
  assert.ok(claude.includes('절대 지우면 안 되는'), '사용자 내용 유실')
  assert.ok(existsSync(join(dir, '.harness', 'backup', 'CLAUDE.md.bak')), '백업 없음')
  assert.equal(readFileSync(join(dir, '.harness', 'backup', 'CLAUDE.md.bak'), 'utf8'), USER_CLAUDE)
})

test('AC3: refresh 멱등 — 재실행 시 파일 변경 0', () => {
  const dir = makeBrownfield()
  run('adapt-apply.mjs', ['--target', dir, '--verify-cmd', 'npm test'])
  const before = [readFileSync(join(dir, 'AGENTS.md'), 'utf8'), readFileSync(join(dir, 'CLAUDE.md'), 'utf8')]
  const r2 = run('adapt-apply.mjs', ['--target', dir, '--verify-cmd', 'npm test'])
  assert.equal(r2.status, 0)
  assert.deepEqual(
    [readFileSync(join(dir, 'AGENTS.md'), 'utf8'), readFileSync(join(dir, 'CLAUDE.md'), 'utf8')],
    before,
  )
  assert.match(r2.stdout, /updated=0/)
})

test('AC4: 왕복 원상복구 — remove 후 트리가 초기와 동일하고 .harness가 없다', () => {
  const dir = makeBrownfield()
  const before = snapshot(dir)
  run('adapt-apply.mjs', ['--target', dir, '--verify-cmd', 'npm test'])
  const r = run('adapt-remove.mjs', ['--target', dir])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(snapshot(dir), before, '트리 원상복구 실패')
  assert.ok(!existsSync(join(dir, '.harness')), '.harness 잔존')
})

test('그린필드: AGENTS.md·CLAUDE.md가 없으면 생성하고, remove 시 삭제된다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-p5-green-'))
  temporaryDirectories.push(dir)
  run('adapt-apply.mjs', ['--target', dir, '--verify-cmd', 'make check'])
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8').split('\n')[0], '@AGENTS.md')
  // 실전(Parallax)에서 잡힌 버그: 블록으로 시작하는 파일의 재실행 churn
  const r2 = run('adapt-apply.mjs', ['--target', dir, '--verify-cmd', 'make check'])
  assert.match(r2.stdout, /updated=0/, '그린필드 멱등 실패')
  run('adapt-remove.mjs', ['--target', dir])
  assert.ok(!existsSync(join(dir, 'AGENTS.md')))
  assert.ok(!existsSync(join(dir, 'CLAUDE.md')))
})

test('remove: 사용자가 만든 .harness/reqs는 보존한다', () => {
  const dir = makeBrownfield()
  run('adapt-apply.mjs', ['--target', dir, '--verify-cmd', 'npm test'])
  mkdirSync(join(dir, '.harness', 'reqs'), { recursive: true })
  writeFileSync(join(dir, '.harness', 'reqs', 'user-req.yaml'), 'metadata: {}\n')
  run('adapt-remove.mjs', ['--target', dir])
  assert.ok(existsSync(join(dir, '.harness', 'reqs', 'user-req.yaml')), '사용자 REQ 삭제됨')
})

test('블록에 캡 수치가 들어간다 (lib/caps 재사용)', () => {
  const dir = makeBrownfield()
  run('adapt-apply.mjs', ['--target', dir, '--verify-cmd', 'npm test'])
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /기존 파일 \d+줄 \/ 신규 314줄/)
})
