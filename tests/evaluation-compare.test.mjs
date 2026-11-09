import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareRuns } from '../evaluation/comparison.mjs'

const CLI = fileURLToPath(new URL('../evaluation/compare-cli.mjs', import.meta.url))
const hash = (digit) => digit.repeat(64)
const identity = () => ({ input_sha256: hash('1'), verifier_sha256: hash('2'), model: 'model-a', effort: 'high', environment_sha256: hash('3') })
const attempt = (outcome = 'pass', changes = {}) => ({
  outcome, input_tokens: 10, output_tokens: 5, cost_usd: 0.01,
  evidence_sha256: outcome === 'pass' ? hash('4') : null, ...changes,
})
const run = (case_id, variant, attempts = [attempt()]) => ({
  case_id, variant, identity: identity(), harness_sha256: hash(variant === 'base' ? 'a' : 'b'), attempts,
})
const sample = () => ({ schema_version: 1, baseline: 'base', candidate: 'selected', runs: [run('case-1', 'base'), run('case-1', 'selected')] })
const issues = (result) => result.eligibility.issues.map((issue) => issue.code)
const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-compare-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('paired outcomes include failed retry spend and expose reported regressions', () => {
  const input = sample()
  input.runs[0].attempts = [attempt('fail', { input_tokens: 50, output_tokens: 10, cost_usd: 0.02 }), attempt()]
  input.runs[1].attempts = [attempt('error', { input_tokens: 30, output_tokens: 10, cost_usd: 0.04 })]
  const result = compareRuns(input)
  assert.equal(result.eligibility.comparable, true)
  assert.deepEqual(result.eligibility.issues, [])
  assert.equal(result.variants.base.attempted_cases, 1)
  assert.equal(result.variants.base.attempts, 2)
  assert.equal(result.variants.base.reported_passes, 1)
  assert.deepEqual(result.variants.base.totals, { input_tokens: 60, output_tokens: 15, total_tokens: 75, cost_usd: 0.03, cost_per_reported_pass_usd: 0.03 })
  assert.equal(result.variants.selected.reported_errors, 1)
  assert.deepEqual(result.paired.reported_regressions, [{ case_id: 'case-1', baseline_outcome: 'pass', candidate_outcome: 'error' }])
  assert.equal(result.descriptive.reported_passes_delta, -1)
})

test('missing usage invalidates the corresponding totals for the whole cohort', () => {
  const input = sample()
  input.runs[0].attempts = [attempt('fail', { input_tokens: null, cost_usd: null }), attempt()]
  const result = compareRuns(input)
  assert.deepEqual(result.variants.base.totals, { input_tokens: null, output_tokens: 10, total_tokens: null, cost_usd: null, cost_per_reported_pass_usd: null })
  assert.deepEqual(result.variants.base.coverage.input_tokens, { reported: 1, attempts: 2 })
  assert.deepEqual(result.variants.base.coverage.cost_usd, { reported: 1, attempts: 2 })
  assert.equal(result.descriptive.total_tokens_delta, null)
  assert.equal(result.descriptive.cost_usd_delta, null)
  delete input.runs[0].attempts[0].input_tokens
  delete input.runs[0].attempts[0].cost_usd
  assert.deepEqual(compareRuns(input).variants.base.totals, result.variants.base.totals)
})

test('complete cost remains usable when token counts are missing', () => {
  const input = sample()
  input.runs[0].attempts[0].input_tokens = null
  const totals = compareRuns(input).variants.base.totals
  assert.equal(totals.input_tokens, null)
  assert.equal(totals.output_tokens, 5)
  assert.equal(totals.total_tokens, null)
  assert.equal(totals.cost_usd, 0.01)
  assert.equal(totals.cost_per_reported_pass_usd, 0.01)
})

test('zero passes have no cost per reported pass and unknown outcomes remain visible', () => {
  const input = sample()
  input.runs[0].attempts = [attempt('unknown')]
  input.runs[1].attempts = [attempt('fail')]
  const result = compareRuns(input)
  assert.equal(result.variants.base.reported_unknowns, 1)
  assert.equal(result.variants.base.reported_passes, 0)
  assert.equal(result.variants.base.totals.cost_per_reported_pass_usd, null)
  assert.deepEqual(result.paired.reported_regressions, [])
})

test('matching missing identities are incomparable, as are differing model, effort and hashes', () => {
  for (const field of ['input_sha256', 'verifier_sha256', 'model', 'effort', 'environment_sha256']) {
    const bothMissing = sample()
    delete bothMissing.runs[0].identity[field]
    bothMissing.runs[1].identity[field] = null
    const missing = compareRuns(bothMissing)
    assert.equal(missing.eligibility.comparable, false, field)
    assert.ok(issues(missing).includes('identity_missing'), field)
    assert.equal(missing.descriptive, null)
    const different = sample()
    different.runs[1].identity[field] = field.endsWith('_sha256') ? hash('5') : 'different'
    assert.equal(compareRuns(different).eligibility.comparable, false, field)
    assert.ok(issues(compareRuns(different)).includes('identity_mismatch'), field)
  }
})

test('unpaired cases and inconsistent or identical harnesses are incomparable', () => {
  const input = sample()
  input.runs.push(run('case-2', 'base'))
  assert.ok(issues(compareRuns(input)).includes('missing_pair'))
  input.runs.push(run('case-2', 'selected'))
  input.runs[2].harness_sha256 = hash('c')
  assert.ok(issues(compareRuns(input)).includes('inconsistent_harness'))
  input.runs[2].harness_sha256 = hash('a')
  input.runs[1].harness_sha256 = hash('a')
  input.runs[3].harness_sha256 = hash('a')
  assert.ok(issues(compareRuns(input)).includes('same_harness'))
  input.runs = []
  assert.equal(compareRuns(input).eligibility.comparable, false)
})

test('duplicate case/variant records and any retry after a pass are invalid', () => {
  const duplicate = sample()
  duplicate.runs.push(structuredClone(duplicate.runs[0]))
  assert.throws(() => compareRuns(duplicate))
  const retry = sample()
  retry.runs[0].attempts.push(attempt('fail'))
  assert.throws(() => compareRuns(retry))
})

test('outcomes, verifier receipts, identities and numeric fields are strictly validated', () => {
  const invalid = [
    (s) => { s.schema_version = 2 },
    (s) => { s.extra = true },
    (s) => { s.runs[0].case_id = ' '.repeat(2) },
    (s) => { s.runs[0].case_id = 'a'.repeat(129) },
    (s) => { s.runs[0].variant = 'other' },
    (s) => { s.runs[0].identity.model = '' },
    (s) => { s.runs[0].identity.input_sha256 = 'A'.repeat(64) },
    (s) => { s.runs[0].harness_sha256 = null },
    (s) => { s.runs[0].attempts[0].outcome = 'maybe' },
    (s) => { s.runs[0].attempts[0].evidence_sha256 = null },
    (s) => { s.runs[0].attempts[0].evidence_sha256 = 'invalid' },
    ...['input_tokens', 'output_tokens'].flatMap((field) => [-1, 0.5, Infinity, NaN, '1', Number.MAX_SAFE_INTEGER + 1].map((value) => (s) => { s.runs[0].attempts[0][field] = value })),
    ...[-1, Infinity, NaN, '1'].map((value) => (s) => { s.runs[0].attempts[0].cost_usd = value }),
    (s) => { s.runs[0].attempts[0].unexpected = 'value' },
  ]
  for (const change of invalid) {
    const input = sample()
    change(input)
    assert.throws(() => compareRuns(input))
  }
})

test('record and attempt limits are enforced before aggregation', () => {
  const tooManyRuns = sample()
  tooManyRuns.runs = Array.from({ length: 1001 }, (_, i) => run(`case-${i}`, 'base'))
  assert.throws(() => compareRuns(tooManyRuns))
  const tooManyAttempts = sample()
  tooManyAttempts.runs[0].attempts = Array.from({ length: 101 }, () => attempt('fail'))
  assert.throws(() => compareRuns(tooManyAttempts))
  tooManyAttempts.runs[0].attempts = []
  assert.throws(() => compareRuns(tooManyAttempts))
})

test('CLI reports local JSON and rejects malformed input with no stdout', (t) => {
  const root = workspace(t)
  writeFileSync(join(root, 'runs.json'), JSON.stringify(sample()))
  const valid = cli(['--root', root, '--file', 'runs.json'])
  assert.equal(valid.status, 0, valid.stderr)
  assert.equal(JSON.parse(valid.stdout).eligibility.comparable, true)
  writeFileSync(join(root, 'invalid.json'), '{invalid')
  writeFileSync(join(root, 'wrong.json'), JSON.stringify({ ...sample(), extra: true }))
  writeFileSync(join(root, 'nonfinite.json'), JSON.stringify(sample()).replace('0.01', '1e400'))
  for (const args of [
    ['--root', root, '--file', 'invalid.json'],
    ['--root', root, '--file', 'wrong.json'],
    ['--root', root, '--file', 'nonfinite.json'],
    ['--root', root, '--file', '../runs.json'],
    ['--root', root, '--file', join(root, 'runs.json')],
    ['--root', root, '--file', 'runs.json', '--file', 'runs.json'],
    ['--root', root],
  ]) {
    const result = cli(args)
    assert.equal(result.status, 2, args.join(' '))
    assert.equal(result.stdout, '')
  }
})

test('CLI denies symlinks and files over the project read limit', (t) => {
  const root = workspace(t)
  writeFileSync(join(root, 'runs.json'), JSON.stringify(sample()))
  symlinkSync(join(root, 'runs.json'), join(root, 'linked.json'))
  writeFileSync(join(root, 'large.json'), ' '.repeat(1024 * 1024 + 1))
  for (const path of ['linked.json', 'large.json']) {
    const result = cli(['--root', root, '--file', path])
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
  }
})

test('CLI scrubs untrusted identifiers in report output and errors', (t) => {
  const root = workspace(t)
  const token = 'sk-' + 'x'.repeat(32)
  const input = sample()
  input.runs[0].case_id = token
  writeFileSync(join(root, 'runs.json'), JSON.stringify(input))
  const result = cli(['--root', root, '--file', 'runs.json'])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!result.stdout.includes(token))
  assert.match(result.stdout, /REDACTED/)
  const badArgs = cli(['--root', root, '--file', 'runs.json', '--' + token])
  assert.equal(badArgs.status, 2)
  assert.ok(!badArgs.stderr.includes(token))
})

test('maximum records and attempts are accepted and every attempt contributes', () => {
  const input = sample()
  input.runs = Array.from({ length: 500 }, (_, i) => [run(`case-${i}`, 'base'), run(`case-${i}`, 'selected')]).flat()
  input.runs[0].attempts = [...Array.from({ length: 99 }, () => attempt('fail')), attempt()]
  const result = compareRuns(input)
  assert.equal(result.eligibility.comparable, true)
  assert.equal(result.variants.base.attempted_cases, 500)
  assert.equal(result.variants.base.attempts, 599)
  assert.equal(result.variants.base.totals.total_tokens, 599 * 15)
  assert.equal(result.paired.paired_cases, 500)
})

test('a candidate pass following a baseline fail is not a reported regression', () => {
  const input = sample()
  input.runs[0].attempts = [attempt('fail')]
  const before = structuredClone(input)
  assert.deepEqual(compareRuns(input).paired.reported_regressions, [])
  assert.deepEqual(input, before)
})

test('unsafe token sums and nonfinite cost sums fail instead of losing precision', () => {
  const tokens = sample()
  tokens.runs[0].attempts = [attempt('fail', { input_tokens: Number.MAX_SAFE_INTEGER }), attempt()]
  assert.throws(() => compareRuns(tokens), /numeric limits/)
  const cost = sample()
  cost.runs[0].attempts = [attempt('fail', { cost_usd: 1e308 }), attempt('pass', { cost_usd: 1e308 })]
  assert.throws(() => compareRuns(cost), /numeric limits/)
})

test('checked-in synthetic example is accepted as reported data', () => {
  const example = JSON.parse(readFileSync(new URL('../evaluation/comparison-example.json', import.meta.url), 'utf8'))
  const result = compareRuns(example)
  assert.equal(result.eligibility.comparable, true)
  assert.equal(result.paired.reported_regressions.length, 1)
  assert.match(result.limitations.join(' '), /not independently authenticated/)
})

test('incomparable identities do not become reported outcome regressions', () => {
  const input = sample()
  input.runs[1].attempts = [attempt('error')]
  input.runs[1].identity.model = 'another-model'
  const result = compareRuns(input)
  assert.equal(result.eligibility.comparable, false)
  assert.deepEqual(result.paired.reported_regressions, [])
})

test('product launcher compares the example and preserves source provenance', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const result = spawnSync(process.execPath, [join(root, 'bin/Ariadne.mjs'), 'eval', 'compare', '--file', 'evaluation/comparison-example.json'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.source.path, 'evaluation/comparison-example.json')
  assert.match(report.source.sha256, /^[a-f0-9]{64}$/)
  assert.equal(report.paired.paired_cases, 2)
})
