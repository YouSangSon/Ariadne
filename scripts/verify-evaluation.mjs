import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { repoRootFromArgs } from './mirror-lib.mjs'

const ID = /^[a-z0-9][a-z0-9-]*$/
const own = (value, key) => Object.hasOwn(value, key)

function validateSuite(suite) {
  assert.equal(suite.schema_version, 1, 'suite schema_version must be 1')
  assert.ok(typeof suite.suite_id === 'string' && ID.test(suite.suite_id), 'invalid suite ID')
  assert.ok(Array.isArray(suite.tasks) && suite.tasks.length >= 3 && suite.tasks.length <= 5, 'three to five controls required')
  assert.equal(new Set(suite.tasks.map((task) => task.id)).size, suite.tasks.length, 'duplicate task IDs')
  for (const task of suite.tasks) {
    assert.ok(typeof task.id === 'string' && ID.test(task.id), 'invalid task ID')
    assert.ok(typeof task.prompt === 'string' && task.prompt.trim(), 'task prompt required')
    for (const files of [task.files, task.reference]) {
      assert.ok(files && typeof files === 'object' && !Array.isArray(files) && Object.keys(files).length, 'file map required')
      for (const [path, text] of Object.entries(files)) {
        assert.ok(path.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\:\x00-\x1f]/.test(part)), 'unsafe file path')
        assert.equal(typeof text, 'string', 'file content must be a string')
      }
    }
    assert.ok(typeof task.entry === 'string' && task.entry.endsWith('.mjs') && own(task.files, task.entry), 'entry must be a fixture module path')
    assert.ok(Object.keys(task.reference).every((path) => own(task.files, path)), 'reference must modify existing files')
    assert.ok(typeof task.export === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(task.export), 'function export required')
    assert.ok(Array.isArray(task.checks) && task.checks.length, 'checks required')
    assert.equal(new Set(task.checks.map((check) => check.id)).size, task.checks.length, 'duplicate check IDs')
    for (const check of task.checks) {
      assert.ok(typeof check.id === 'string' && ID.test(check.id), 'invalid check ID')
      assert.ok(Array.isArray(check.args) && own(check, 'expected'), 'JSON args and expected result required')
    }
    assert.ok(Array.isArray(task.baseline_failures) && task.baseline_failures.length, 'baseline failures required')
    assert.equal(new Set(task.baseline_failures).size, task.baseline_failures.length, 'duplicate baseline failures')
    assert.ok(task.baseline_failures.every((id) => task.checks.some((check) => check.id === id)), 'unknown baseline failures')
  }
}

async function probe(root) {
  try {
    const task = JSON.parse(readFileSync(0, 'utf8'))
    const module = await import(pathToFileURL(join(root, task.entry)).href)
    assert.equal(typeof module[task.export], 'function')
    const checks = []
    for (const check of task.checks) {
      const actual = await module[task.export](...check.args)
      checks.push({ id: check.id, passed: isDeepStrictEqual(actual, check.expected) })
    }
    process.stdout.write(JSON.stringify({ task_id: task.id, checks }))
  } catch {
    process.exitCode = 2
  }
}

function measure(task, phase, root) {
  const files = phase === 'reference' ? { ...task.files, ...task.reference } : task.files
  mkdirSync(root, { recursive: true })
  for (const [path, text] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--probe', root], {
    input: JSON.stringify(task), encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  })
  const invalid = `${task.id} ${phase}: invalid execution`
  if (r.error || r.signal || r.status !== 0) throw new Error(`${invalid} (${r.error?.code ?? r.signal ?? r.status})`)
  let checks
  try {
    const response = JSON.parse(r.stdout)
    assert.equal(response.task_id, task.id)
    checks = response.checks
    assert.deepEqual(checks.map((check) => check.id), task.checks.map((check) => check.id))
    assert.ok(checks.every((check) => typeof check.passed === 'boolean'))
  } catch {
    throw new Error(invalid)
  }
  return checks.filter((check) => !check.passed).map((check) => check.id)
}

function verify(root) {
  const raw = readFileSync(join(root, 'evaluation/suite.json'))
  const digest = createHash('sha256').update(raw).digest('hex')
  const expected = readFileSync(join(root, 'evaluation/suite.sha256'), 'utf8').trim().split(/\s+/)[0]
  assert.ok(/^[a-f0-9]{64}$/.test(expected) && digest === expected, 'suite hash mismatch')
  const suite = JSON.parse(raw)
  validateSuite(suite)
  const workspace = mkdtempSync(join(tmpdir(), 'ariadne-controls-'))
  const tasks = []
  try {
    for (const task of suite.tasks) {
      const failures = measure(task, 'baseline', join(workspace, task.id, 'baseline'))
      assert.deepEqual(failures, task.baseline_failures, `${task.id}: unexpected baseline failures`)
      const referenceFailures = measure(task, 'reference', join(workspace, task.id, 'reference'))
      assert.deepEqual(referenceFailures, [], `${task.id}: reference mismatch`)
      tasks.push({ id: task.id, baseline_failures: failures, reference_passed: task.checks.length })
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
  return { status: 'verified_fixture_controls', p8_quality: 'not_measured', suite_sha256: digest, tasks }
}

if (process.argv[2] === '--probe') {
  await probe(process.argv[3])
} else {
  try {
    const args = process.argv.slice(2)
    assert.ok(!args.length || (args.length === 2 && args[0] === '--root' && args[1] && !args[1].startsWith('--')), 'usage: verify-evaluation.mjs [--root <dir>]')
    console.log(JSON.stringify(verify(repoRootFromArgs(process.argv)), null, 2))
  } catch (error) {
    console.error(`verify-evaluation: ${error.message}`)
    process.exitCode = 1
  }
}
