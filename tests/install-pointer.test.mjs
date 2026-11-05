// AC5 (p6-deploy): install --global-pointer — opt-in 주입, 멱등, uninstall 원상 복원
// 실제 글로벌은 건드리지 않는다(D3) — HOME을 격리 tmpdir로 바꿔 스폰
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const temporaryDirectories = []
after(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }) })

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (script, args, home) =>
  spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })

const USER_CLAUDE_GLOBAL = '# 내 글로벌 규칙\n\n사용자가 직접 쓴 내용.\n'

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'harness-p6-home-'))
  temporaryDirectories.push(home)
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), USER_CLAUDE_GLOBAL)
  return home
}

test('기본 install은 글로벌 포인터를 주입하지 않는다 (D3 opt-in)', () => {
  const home = makeHome()
  const r = run('install.mjs', [], home)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), USER_CLAUDE_GLOBAL)
  assert.ok(!existsSync(join(home, '.codex', 'AGENTS.md')))
})

test('--global-pointer: CLAUDE.md 포인터 블록 + 사용자 내용 보존, codex 코어 사본 생성', () => {
  const home = makeHome()
  const r = run('install.mjs', ['--global-pointer'], home)
  assert.equal(r.status, 0, r.stderr)

  const claude = readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')
  assert.ok(claude.includes('<!-- harness:begin'), '마커 없음')
  assert.ok(claude.includes(join(home, '.harness', 'core', 'AGENTS.core.md')), '포인터 경로 없음')
  assert.ok(claude.includes('사용자가 직접 쓴 내용'), '사용자 내용 유실')

  const codex = readFileSync(join(home, '.codex', 'AGENTS.md'), 'utf8')
  assert.ok(codex.includes('<!-- harness:begin'))
  const core = readFileSync(join(ROOT, 'core', 'AGENTS.core.md'), 'utf8')
  assert.ok(codex.includes(core.trim()), 'codex에 코어 규칙 사본 없음')
})

test('멱등: --global-pointer 재실행 시 파일 변경 0', () => {
  const home = makeHome()
  run('install.mjs', ['--global-pointer'], home)
  const claude1 = readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')
  const codex1 = readFileSync(join(home, '.codex', 'AGENTS.md'), 'utf8')
  const r = run('install.mjs', ['--global-pointer'], home)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), claude1)
  assert.equal(readFileSync(join(home, '.codex', 'AGENTS.md'), 'utf8'), codex1)
})

test('uninstall: 포인터 블록 제거 — 기존 파일은 원상, 생성 파일은 삭제', () => {
  const home = makeHome()
  run('install.mjs', ['--global-pointer'], home)
  const r = run('uninstall.mjs', [], home)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), USER_CLAUDE_GLOBAL)
  assert.ok(!existsSync(join(home, '.codex', 'AGENTS.md')), '생성 파일이 남아 있음')
})

test('installed context entrypoint includes its runtime closure and uninstall preserves foreign files', () => {
  const home = makeHome()
  const prefix = join(home, '.harness')
  const project = join(home, 'project')
  mkdirSync(join(project, '.harness', 'reqs'), { recursive: true })
  writeFileSync(join(project, '.harness', 'reqs', 'installed.yaml'), 'metadata:\n  req_id: installed\n  status: ready_for_routing\nrequirement:\n  user_intent: installed context works\n')
  const installed = run('install.mjs', [], home)
  assert.equal(installed.status, 0, installed.stderr)
  const manifest = JSON.parse(readFileSync(join(prefix, 'manifest.json'), 'utf8'))
  assert.ok(manifest.files.includes('lib/context-pack.mjs'))
  assert.ok(manifest.files.includes('modules/context/application.mjs'))
  const context = spawnSync(process.execPath, [join(prefix, 'lib/context-pack.mjs'), '--root', project, '--req', 'installed', '--budget', 'brief'], { cwd: home, encoding: 'utf8' })
  assert.equal(context.status, 0, context.stderr)
  assert.match(context.stdout, /installed context works/)
  assert.match(context.stdout, /## project_summary/)
  const foreign = join(prefix, 'modules/context/user-note.md')
  writeFileSync(foreign, 'keep my note')
  const removed = run('uninstall.mjs', [], home)
  assert.equal(removed.status, 0, removed.stderr)
  for (const path of manifest.files) assert.equal(existsSync(join(prefix, path)), false, path)
  assert.equal(readFileSync(foreign, 'utf8'), 'keep my note')
})

test('repeated global-pointer installs retain the original restoration records', () => {
  const home = makeHome()
  for (const args of [['--global-pointer'], ['--global-pointer']]) {
    const installed = run('install.mjs', args, home)
    assert.equal(installed.status, 0, installed.stderr)
  }
  const removed = run('uninstall.mjs', [], home)
  assert.equal(removed.status, 0, removed.stderr)
  assert.equal(readFileSync(join(home, '.claude/CLAUDE.md'), 'utf8'), USER_CLAUDE_GLOBAL)
  assert.equal(existsSync(join(home, '.codex/AGENTS.md')), false)
})
