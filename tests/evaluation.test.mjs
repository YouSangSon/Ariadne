import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/verify-evaluation.mjs', import.meta.url))
const RAW_SUITE = readFileSync(new URL('../evaluation/suite.json', import.meta.url), 'utf8')
const SUITE_HASH = readFileSync(new URL('../evaluation/suite.sha256', import.meta.url), 'utf8')
const SUITE = JSON.parse(RAW_SUITE)

function fixture(t, change = null) {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-controls-check-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'evaluation'))
  mkdirSync(join(root, 'tmp'))
  const suite = structuredClone(SUITE)
  if (change) change(suite, root)
  const raw = change ? JSON.stringify(suite) : RAW_SUITE
  writeFileSync(join(root, 'evaluation/suite.json'), raw)
  writeFileSync(join(root, 'evaluation/suite.sha256'), change ? createHash('sha256').update(raw).digest('hex') + '\n' : SUITE_HASH)
  return root
}

function run(root) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], {
    encoding: 'utf8', env: { ...process.env, TMPDIR: join(root, 'tmp') },
  })
  assert.deepEqual(readdirSync(join(root, 'tmp')), [], 'task-owned temporary directories remain')
  return result
}

test('trusted controls distinguish exact baseline failures from passing references', (t) => {
  const r = run(fixture(t))
  assert.equal(r.status, 0, r.stderr)
  const result = JSON.parse(r.stdout)
  assert.equal(result.status, 'verified_fixture_controls')
  assert.equal(result.p8_quality, 'not_measured')
  assert.equal(result.tasks.length, 3)
  for (const [i, task] of result.tasks.entries()) {
    assert.deepEqual(task.baseline_failures, SUITE.tasks[i].baseline_failures)
    assert.equal(task.reference_passed, SUITE.tasks[i].checks.length)
  }
})

test('changed suite cannot reuse its old hash', (t) => {
  const root = fixture(t)
  writeFileSync(join(root, 'evaluation/suite.json'), readFileSync(join(root, 'evaluation/suite.json'), 'utf8') + '\n')
  const r = run(root)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /hash/)
  assert.equal(r.stdout, '')
})

test('rehashed unsafe file paths are rejected before materialization', (t) => {
  for (const makePath of [() => '../outside.mjs', (root) => join(root, 'outside.mjs'), () => 'src/../../outside.mjs', () => 'src\\outside.mjs']) {
    const root = fixture(t, (suite, root) => { suite.tasks[0].files[makePath(root)] = 'unsafe' })
    const r = run(root)
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /path/)
    assert.equal(r.stdout, '')
    assert.equal(existsSync(join(root, 'outside.mjs')), false)
  }
})

test('missing and additional baseline mismatch IDs are rejected', (t) => {
  for (const ids of [[], ['mixed'], ['mixed', 'all-read', 'empty']]) {
    const root = fixture(t, (suite) => { suite.tasks[0].baseline_failures = ids })
    const r = run(root)
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /baseline failures/)
    assert.equal(r.stdout, '')
  }
})

test('baseline import, call and output errors cannot count as expected failures', (t) => {
  for (const code of [
    'this is invalid JavaScript',
    "export function unreadCount() { throw new Error('broken fixture') }",
    "console.log('not a worker response'); export function unreadCount() { return 2 }",
  ]) {
    const root = fixture(t, (suite) => { suite.tasks[0].files['src/messages.mjs'] = code })
    const r = run(root)
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /invalid execution/)
    assert.equal(r.stdout, '')
  }
})

test('reference mismatch and runtime errors are rejected', (t) => {
  for (const code of [
    'export function unreadCount() { return 99 }',
    "export function unreadCount() { throw new Error('broken reference') }",
  ]) {
    const root = fixture(t, (suite) => { suite.tasks[0].reference['src/messages.mjs'] = code })
    const r = run(root)
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /reference/)
    assert.equal(r.stdout, '')
  }
})

test('late worker errors cannot masquerade as baseline comparison failures', (t) => {
  const root = fixture(t, (suite) => {
    suite.tasks[0].files['src/messages.mjs'] = "setImmediate(() => { throw new Error('late fixture failure') }); export function unreadCount(messages) { return messages.length }"
  })
  const r = run(root)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /baseline: invalid execution/)
  assert.equal(r.stdout, '')
})

test('a timed-out baseline is invalid and its temporary workspace is removed', (t) => {
  const root = fixture(t, (suite) => {
    suite.tasks[0].files['src/messages.mjs'] = "process.on('SIGTERM', () => {}); export function unreadCount() { while (true) {} }"
  })
  const r = run(root)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /invalid execution/)
  assert.equal(r.stdout, '')
})

test('duplicate task/check IDs and unknown baseline IDs are rejected', (t) => {
  for (const change of [
    (suite) => { suite.tasks[1].id = suite.tasks[0].id },
    (suite) => { suite.tasks[0].checks[1].id = suite.tasks[0].checks[0].id },
    (suite) => { suite.tasks[0].baseline_failures = ['unknown'] },
  ]) {
    const r = run(fixture(t, change))
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /duplicate|baseline failures/)
    assert.equal(r.stdout, '')
  }
})
