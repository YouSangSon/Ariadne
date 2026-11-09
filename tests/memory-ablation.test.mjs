import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateMemoryAblation, memoryConditionDigest, memoryAblationPlanDigest } from '../evaluation/memory-ablation.mjs'

const CLI = fileURLToPath(new URL('../evaluation/memory-ablation-cli.mjs', import.meta.url))
const hash = (digit) => digit.repeat(64)
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const memory = (id, digit) => ({ id, sha256: hash(digit) })
const usage = (cost_usd = 0.01) => ({ input_tokens: 10, output_tokens: 5, cost_usd })
const identity = () => ({ input_sha256: hash('1'), verifier_sha256: hash('2'), model: 'offline-model', effort: 'high', environment_sha256: hash('3') })
const attempt = (outcome = 'pass') => ({ outcome, ...usage(), evidence_sha256: outcome === 'pass' ? hash('4') : null })
function pin(input) {
  input.plan.condition_sha256 = Object.fromEntries(['base', 'selected'].map((variant) => [variant, memoryConditionDigest(input.conditions[variant], sha256)]))
  input.plan_sha256 = memoryAblationPlanDigest(input.plan, sha256)
  for (const run of input.comparison.runs) run.harness_sha256 = input.plan.condition_sha256[run.variant]
  return input
}
function sample() {
  const base = { experiment_context: { organization_id: 'org-1', scope_type: 'project', scope_id: 'project-1' }, configuration_sha256: hash('a'), required_memories: [memory('protection', '5')], optional_memories: [memory('other', '6'), memory('another', '8')] }
  const target = memory('target', '7')
  const conditions = { base, selected: { ...structuredClone(base), optional_memories: [...structuredClone(base.optional_memories), structuredClone(target)] } }
  return pin({
    schema_version: 1, target, conditions,
    plan: { cases: [{ case_id: 'case-1', identity: identity() }], max_attempts: 2, stop_rule: 'pass_or_max_attempts', condition_sha256: { base: hash('a'), selected: hash('b') } },
    plan_sha256: hash('a'),
    comparison: { schema_version: 1, baseline: 'base', candidate: 'selected', runs: ['base', 'selected'].map((variant) => ({ case_id: 'case-1', variant, identity: identity(), harness_sha256: hash('a'), attempts: [attempt()] })) },
    experiment_costs: { construction: usage(0.1), verification: usage(0.2), maintenance: usage(0.3) },
  })
}
const codes = (report) => report.eligibility.issues.map((issue) => issue.code)

test('hashing requires an explicit SHA-256 port with a valid digest and no fallback', () => {
  const input = sample()
  for (const hashText of [undefined, null, 'sha256', () => 'invalid']) {
    assert.throws(() => memoryConditionDigest(input.conditions.base, hashText), /SHA-256/)
    assert.throws(() => memoryAblationPlanDigest(input.plan, hashText), /SHA-256/)
    assert.throws(() => evaluateMemoryAblation(input, hashText), /SHA-256/)
  }
})

test('one optional memory is paired by pinned content without mutating v1 records', () => {
  const input = sample()
  const before = structuredClone(input)
  const report = evaluateMemoryAblation(input, sha256)
  assert.equal(report.eligibility.comparable, true)
  assert.equal(report.comparison.paired.paired_cases, 1)
  assert.equal(report.comparison.variants.selected.reported_passes, 1)
  assert.deepEqual(report.target, input.target)
  assert.deepEqual(report.experiment_context, input.conditions.base.experiment_context)
  assert.deepEqual(input, before)
  assert.match(report.limitations.join(' '), /self-reported/)
  assert.match(report.limitations.join(' '), /not causal/)
})

test('condition bindings reject changed configurations, protection, other memories and target hashes', () => {
  const changes = [
    (s) => { s.conditions.selected.configuration_sha256 = hash('b') },
    (s) => { s.conditions.selected.experiment_context.organization_id = 'org-2' },
    (s) => { s.conditions.selected.experiment_context.scope_type = 'user' },
    (s) => { s.conditions.selected.experiment_context.scope_id = 'project-2' },
    (s) => { s.conditions.selected.required_memories = [] },
    (s) => { s.conditions.selected.optional_memories[0].sha256 = hash('8') },
    (s) => { s.conditions.selected.optional_memories.reverse() },
    (s) => { s.conditions.base.optional_memories.push(s.target) },
    (s) => { s.conditions.selected.required_memories.push(s.target) },
    (s) => { s.conditions.selected.optional_memories.at(-1).sha256 = hash('8') },
    (s) => { s.conditions.selected.optional_memories.push(memory('extra', '8')) },
    (s) => { s.conditions.base.required_memories.push(s.conditions.base.optional_memories[0]) },
  ]
  for (const change of changes) {
    const input = sample()
    change(input)
    assert.throws(() => evaluateMemoryAblation(pin(input), sha256))
  }
  const stale = sample()
  stale.comparison.runs[0].harness_sha256 = hash('f')
  assert.throws(() => evaluateMemoryAblation(stale, sha256), /condition/)
})

test('a required target can never be ablated even when both condition digests are repinned', () => {
  const input = sample()
  input.conditions.base.required_memories.push(input.target)
  input.conditions.selected.required_memories.push(input.target)
  input.conditions.selected.optional_memories.pop()
  pin(input)
  assert.throws(() => evaluateMemoryAblation(input, sha256), /optional/)
})

test('plan rejects extra cases, over-budget attempts and altered pins', () => {
  const changes = [
    (s) => { s.comparison.runs[0].case_id = 'extra-case' },
    (s) => { s.comparison.runs[0].attempts = [attempt('fail'), attempt('error'), attempt()] },
    (s) => { s.plan.max_attempts = 3 },
    (s) => { s.plan.condition_sha256.selected = hash('f') },
  ]
  for (const change of changes) {
    const input = sample()
    change(input)
    assert.throws(() => evaluateMemoryAblation(input, sha256))
  }
})

test('canceled, absent and unknown trials remain visible but cannot become a complete comparison', () => {
  const incomplete = sample()
  incomplete.comparison.runs[1].attempts = [attempt('unknown')]
  const report = evaluateMemoryAblation(incomplete, sha256)
  assert.equal(report.eligibility.comparable, false)
  assert.ok(codes(report).includes('incomplete_trial'))
  assert.equal(report.comparison.variants.selected.reported_unknowns, 1)
  assert.equal(report.descriptive, null)
  const missing = sample()
  missing.comparison.runs = []
  assert.ok(codes(evaluateMemoryAblation(missing, sha256)).includes('planned_run_missing'))
  const exhausted = sample()
  exhausted.comparison.runs[1].attempts = [attempt('error'), attempt('fail')]
  assert.equal(evaluateMemoryAblation(exhausted, sha256).eligibility.comparable, true)
})

test('pinned identities preserve missing identity and mismatch ineligibility', () => {
  for (const value of [null, 'other-model']) {
    const input = sample()
    input.comparison.runs[0].identity.model = value
    input.comparison.runs[1].identity.model = value
    const report = evaluateMemoryAblation(input, sha256)
    assert.equal(report.eligibility.comparable, false)
    assert.ok(codes(report).includes('planned_identity_mismatch'))
  }
})

test('reported outcome labels distinguish gains, regressions, unchanged and unknown without ranking', () => {
  for (const [base, selected, expected] of [['fail', 'pass', 'improvement'], ['pass', 'fail', 'regression'], ['pass', 'pass', 'unchanged'], ['unknown', 'pass', 'unknown'], ['fail', 'error', 'unknown']]) {
    const input = sample()
    input.plan.max_attempts = 1
    input.comparison.runs[0].attempts = [attempt(base)]
    input.comparison.runs[1].attempts = [attempt(selected)]
    pin(input)
    assert.deepEqual(evaluateMemoryAblation(input, sha256).observations, [{ case_id: 'case-1', reported_outcome: expected }])
  }
  const incomplete = sample()
  incomplete.comparison.runs.pop()
  assert.equal(evaluateMemoryAblation(incomplete, sha256).observations[0].reported_outcome, 'unknown')
})

test('preparation costs are counted once per experiment without assigning them to a variant', () => {
  const input = sample()
  input.plan.cases.push({ case_id: 'case-2', identity: identity() })
  input.comparison.runs.push(...input.comparison.runs.map((run) => ({ ...structuredClone(run), case_id: 'case-2' })))
  pin(input)
  const costs = evaluateMemoryAblation(input, sha256).costs
  assert.equal(costs.overhead_totals.total_tokens, 45)
  assert.ok(Math.abs(costs.overhead_totals.cost_usd - 0.6) < 1e-12)
  assert.equal(costs.experiment_totals.total_tokens, 105)
  assert.ok(Math.abs(costs.experiment_totals.cost_usd - 0.64) < 1e-12)
  assert.equal(Object.hasOwn(costs, 'break_even'), false)
  assert.equal(Object.hasOwn(costs, 'selected_total'), false)
})

test('unknown costs and incomplete attempt usage remain null with field coverage', () => {
  const input = sample()
  input.experiment_costs.maintenance.cost_usd = null
  input.comparison.runs[0].attempts[0].input_tokens = null
  const report = evaluateMemoryAblation(input, sha256)
  assert.equal(report.costs.overhead_totals.cost_usd, null)
  assert.equal(report.costs.experiment_totals.cost_usd, null)
  assert.equal(report.costs.experiment_totals.total_tokens, null)
  assert.equal(report.comparison.variants.base.totals.input_tokens, null)
  assert.deepEqual(report.costs.overhead_coverage.cost_usd, { reported: 2, components: 3 })
})

test('missing or incomplete planned executions retain recorded spend without claiming a complete experiment total', () => {
  for (const missing of [true, false]) {
    const input = sample()
    if (missing) input.comparison.runs = []
    else input.comparison.runs[1].attempts = [attempt('fail')]
    const report = evaluateMemoryAblation(input, sha256)
    assert.deepEqual(report.costs.experiment_totals, { input_tokens: null, output_tokens: null, cost_usd: null, total_tokens: null })
    assert.equal(report.costs.recorded_totals.total_tokens, missing ? 45 : 75)
    assert.ok(Math.abs(report.costs.recorded_totals.cost_usd - (missing ? 0.6 : 0.62)) < 1e-12)
    assert.deepEqual(report.costs.execution_coverage, { planned_runs: 2, reported_runs: missing ? 0 : 2, incomplete_trials: missing ? 0 : 1, complete: false })
  }
})

test('identity mismatch alone does not discard complete recorded experiment usage', () => {
  const input = sample()
  input.comparison.runs[1].identity.model = 'different-model'
  const report = evaluateMemoryAblation(input, sha256)
  assert.equal(report.eligibility.comparable, false)
  assert.equal(report.costs.execution_coverage.complete, true)
  assert.equal(report.costs.experiment_totals.total_tokens, 75)
  assert.deepEqual(report.costs.experiment_totals, report.costs.recorded_totals)
})

test('strict bounded manifests, plans and usage reject unknown keys and invalid numbers', () => {
  const changes = [
    (s) => { s.extra = true }, (s) => { s.schema_version = 2 },
    (s) => { s.target.extra = true }, (s) => { s.target.id = '' },
    (s) => { s.target.sha256 = 'x' }, (s) => { s.conditions.extra = {} },
    (s) => { s.conditions.base.extra = true },
    (s) => { s.conditions.base.experiment_context.scope_type = 'global' },
    (s) => { s.conditions.base.experiment_context.organization_id = '' },
    (s) => { s.conditions.base.experiment_context.extra = true },
    (s) => { s.conditions.base.required_memories = Array.from({ length: 1001 }, (_, n) => memory(`m-${n}`, 'a')) },
    (s) => { s.plan.max_attempts = 101 }, (s) => { s.plan.max_attempts = 0 },
    (s) => { s.plan.stop_rule = 'whenever' }, (s) => { s.plan.cases = [] },
    (s) => { s.plan.cases.push(s.plan.cases[0]) }, (s) => { s.plan.extra = true },
    (s) => { s.experiment_costs.extra = usage() },
    (s) => { s.experiment_costs.maintenance.cost_usd = -1 },
    (s) => { s.experiment_costs.maintenance.input_tokens = 0.5 },
    (s) => { s.experiment_costs.maintenance.output_tokens = Number.MAX_SAFE_INTEGER },
    (s) => { s.experiment_costs.maintenance.cost_usd = Infinity },
  ]
  for (const change of changes) {
    const input = sample()
    change(input)
    assert.throws(() => evaluateMemoryAblation(input, sha256))
  }
})

test('digest canonicalizes object keys and preserves memory selection order', () => {
  const condition = sample().conditions.base
  assert.equal(memoryConditionDigest(condition, sha256), memoryConditionDigest({ optional_memories: condition.optional_memories, required_memories: condition.required_memories, configuration_sha256: condition.configuration_sha256, experiment_context: condition.experiment_context }, sha256))
  const input = sample()
  input.conditions.selected.optional_memories.unshift(memory('first', '8'))
  const forward = memoryConditionDigest(input.conditions.selected, sha256)
  input.conditions.selected.optional_memories.reverse()
  assert.notEqual(memoryConditionDigest(input.conditions.selected, sha256), forward)
})

test('synthetic example describes reported improvement with unknown maintenance costs', () => {
  const input = JSON.parse(readFileSync(new URL('../evaluation/memory-ablation-example.json', import.meta.url), 'utf8'))
  const report = evaluateMemoryAblation(input, sha256)
  assert.equal(report.eligibility.comparable, true)
  assert.equal(report.observations[0].reported_outcome, 'improvement')
  assert.equal(report.costs.experiment_totals.cost_usd, null)
})

test('CLI uses guarded reads and scrubs output and errors without artifacts', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-memory-ablation-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const input = sample()
  const token = 'sk-' + 'x'.repeat(32)
  input.target.id = token
  input.conditions.selected.optional_memories.at(-1).id = token
  pin(input)
  writeFileSync(join(root, 'input.json'), JSON.stringify(input))
  const cli = (args) => spawnSync(process.execPath, [CLI, '--root', root, ...args], { encoding: 'utf8' })
  const report = cli(['--file', 'input.json'])
  assert.equal(report.status, 0, report.stderr)
  assert.equal(JSON.parse(report.stdout).source.path, 'input.json')
  assert.ok(!report.stdout.includes(token))
  assert.match(report.stdout, /REDACTED/)
  symlinkSync(join(root, 'input.json'), join(root, 'link.json'))
  writeFileSync(join(root, 'large.json'), ' '.repeat(1024 * 1024 + 1))
  writeFileSync(join(root, 'invalid.json'), '{bad')
  for (const args of [[], ['--file', 'link.json'], ['--file', 'large.json'], ['--file', 'invalid.json'], ['--file', '../input.json'], ['--file', join(root, 'input.json')], ['--file', 'input.json', '--file', 'input.json'], ['--file', 'input.json', '--' + token]]) {
    const result = cli(args)
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.ok(!result.stderr.includes(token))
  }
})
