import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fixture(t, mirror) {
  const root = mkdtempSync(join(tmpdir(), 'harness-verify-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'lib'))
  mkdirSync(join(root, 'tests'))
  mkdirSync(join(root, 'core/domain'), { recursive: true })
  mkdirSync(join(root, 'core/application'), { recursive: true })
  for (const path of ['core/domain/verification.mjs', 'core/application/verification.mjs']) copyFileSync(new URL(`../${path}`, import.meta.url), join(root, path))
  copyFileSync(new URL('../core/domain/commit.mjs', import.meta.url), join(root, 'core/domain/commit.mjs'))
  copyFileSync(new URL('../scripts/verify.mjs', import.meta.url), join(root, 'scripts/verify.mjs'))
  copyFileSync(new URL('../lib/module-selection.mjs', import.meta.url), join(root, 'lib/module-selection.mjs'))
  copyFileSync(new URL('../lib/scrub.mjs', import.meta.url), join(root, 'lib/scrub.mjs'))
  writeFileSync(join(root, 'scripts/mirror-lib.mjs'), 'export const repoRootFromArgs = () => process.cwd()\n')
  writeFileSync(join(root, 'scripts/check-mirror.mjs'), mirror)
  writeFileSync(join(root, 'tests/smoke.test.mjs'), "import { test } from 'node:test'; test('fixture', () => {})\n")
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  }
  git(['init', '-q'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test',
    'commit', '--allow-empty', '-qm', 'test: fixture\n\nREQ: none (isolated fixture)'])
  return root
}

function run(root) {
  const { NODE_TEST_CONTEXT, ...env } = process.env
  return spawnSync(process.execPath, ['scripts/verify.mjs'], { cwd: root, env, encoding: 'utf8' })
}

test('verify rejects a silent nonzero mirror check', (t) => {
  const r = run(fixture(t, 'process.exit(7)'))
  assert.notEqual(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stderr, /check-mirror.*7/)
  assert.doesNotMatch(r.stdout, /verify: green/)
})

test('verify reports a terminated check as failure', (t) => {
  const r = run(fixture(t, "process.kill(process.pid, 'SIGTERM')"))
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /SIGTERM/)
})

test('verify preserves the actual failing test output', (t) => {
  const root = fixture(t, '')
  writeFileSync(join(root, 'tests/smoke.test.mjs'), "import { test } from 'node:test'; test('fixture', () => { throw new Error('actual failure detail') })\n")
  const r = run(root)
  assert.notEqual(r.status, 0)
  assert.match(r.stdout + r.stderr, /actual failure detail/)
})

test('verify succeeds only when every command exits zero', (t) => {
  const r = run(fixture(t, ''))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /verify: green/)
})

test('core verification leaves internal package tests to their owning runners', (t) => {
  const root = fixture(t, '')
  mkdirSync(join(root, 'packages/code/tests'), { recursive: true })
  writeFileSync(join(root, 'packages/code/tests/other.test.mjs'), "throw new Error('wrong test runner')\n")
  const result = run(root)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('verify keeps stdout-only failure details and redacts secrets', (t) => {
  const r = run(fixture(t, "console.log('stdout-only failure sk-ant-' + 'a'.repeat(50)); process.exit(9)"))
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /stdout-only failure/)
  assert.match(r.stderr, /REDACTED_ANTHROPIC_KEY/)
  assert.doesNotMatch(r.stderr, /sk-ant-/)
})

test('verify reports output collection errors without exposing truncated payload', (t) => {
  const root = fixture(t, "process.stdout.write('-----BEGIN PRIVATE KEY-----\\n' + 'sensitive-material'.repeat(100000)); process.exitCode = 1")
  const r = run(root)
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /ENOBUFS/)
  assert.doesNotMatch(r.stderr, /sensitive-material|BEGIN PRIVATE KEY/)
})
