import { compareRuns } from './comparison.mjs'

const HASH = /^[a-f0-9]{64}$/
const IDENTITY_FIELDS = ['input_sha256', 'verifier_sha256', 'model', 'effort', 'environment_sha256']
const USAGE_FIELDS = ['input_tokens', 'output_tokens', 'cost_usd']
const COMPONENTS = ['construction', 'verification', 'maintenance']
const VARIANTS = ['base', 'selected']

function ensure(condition, message) { if (!condition) throw new Error(message) }
function object(value, fields, message) {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), message)
  ensure(Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)), message)
}
function id(value) { return typeof value === 'string' && value.length <= 128 && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value) }
function hash(value) { return typeof value === 'string' && HASH.test(value) }
function memory(value) {
  object(value, ['id', 'sha256'], 'Invalid memory reference')
  ensure(id(value.id) && hash(value.sha256), 'Invalid memory reference')
}
function condition(value) {
  object(value, ['experiment_context', 'configuration_sha256', 'required_memories', 'optional_memories'], 'Invalid memory condition')
  object(value.experiment_context, ['organization_id', 'scope_type', 'scope_id'], 'Invalid experiment context')
  ensure(id(value.experiment_context.organization_id) && ['project', 'user'].includes(value.experiment_context.scope_type) && id(value.experiment_context.scope_id), 'Invalid experiment context')
  ensure(hash(value.configuration_sha256), 'Invalid condition configuration hash')
  const ids = new Set()
  for (const field of ['required_memories', 'optional_memories']) {
    ensure(Array.isArray(value[field]) && value[field].length <= 1000, 'Invalid memory selection count')
    for (const ref of value[field]) {
      memory(ref)
      ensure(!ids.has(ref.id), 'Duplicate memory selection')
      ids.add(ref.id)
    }
  }
}
function plan(value) {
  object(value, ['cases', 'max_attempts', 'stop_rule', 'condition_sha256'], 'Invalid ablation plan')
  ensure(Number.isSafeInteger(value.max_attempts) && value.max_attempts > 0 && value.max_attempts <= 100, 'Invalid planned attempt limit')
  ensure(value.stop_rule === 'pass_or_max_attempts', 'Invalid planned stop rule')
  object(value.condition_sha256, VARIANTS, 'Invalid planned condition hashes')
  ensure(VARIANTS.every((variant) => hash(value.condition_sha256[variant])), 'Invalid planned condition hash')
  ensure(Array.isArray(value.cases) && value.cases.length > 0 && value.cases.length <= 500, 'Invalid planned case count')
  const ids = new Set()
  for (const entry of value.cases) {
    object(entry, ['case_id', 'identity'], 'Invalid planned case')
    ensure(id(entry.case_id) && !ids.has(entry.case_id), 'Invalid or duplicate planned case ID')
    ids.add(entry.case_id)
    object(entry.identity, IDENTITY_FIELDS, 'Invalid planned identity')
    for (const field of IDENTITY_FIELDS) ensure(field.endsWith('_sha256') ? hash(entry.identity[field]) : id(entry.identity[field]), 'Invalid planned identity field')
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function digest(value, hashText) {
  ensure(typeof hashText === 'function', 'A SHA-256 hash function is required')
  const result = hashText(canonical(value))
  ensure(hash(result), 'SHA-256 hash function returned an invalid digest')
  return result
}
export function memoryConditionDigest(value, hashText) { condition(value); return digest(value, hashText) }
export function memoryAblationPlanDigest(value, hashText) { plan(value); return digest(value, hashText) }

function usage(value) {
  object(value, USAGE_FIELDS, 'Invalid experiment cost component')
  for (const field of USAGE_FIELDS) {
    const amount = value[field]
    ensure(amount === null || (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && (field === 'cost_usd' || Number.isSafeInteger(amount))), 'Invalid experiment usage')
  }
}
function totals(entries) {
  const result = {}
  for (const field of USAGE_FIELDS) {
    const amounts = entries.map((entry) => entry[field])
    const sum = amounts.filter((amount) => amount !== null).reduce((total, amount) => total + amount, 0)
    ensure(Number.isFinite(sum) && (field === 'cost_usd' || Number.isSafeInteger(sum)), 'Experiment usage total exceeds numeric limits')
    result[field] = amounts.includes(null) ? null : sum
  }
  result.total_tokens = result.input_tokens === null || result.output_tokens === null ? null : result.input_tokens + result.output_tokens
  ensure(result.total_tokens === null || Number.isSafeInteger(result.total_tokens), 'Experiment usage total exceeds numeric limits')
  return result
}

export function evaluateMemoryAblation(input, hashText) {
  object(input, ['schema_version', 'target', 'conditions', 'plan', 'plan_sha256', 'comparison', 'experiment_costs'], 'Invalid memory ablation object')
  ensure(input.schema_version === 1, 'Invalid memory ablation version')
  memory(input.target)
  object(input.conditions, VARIANTS, 'Invalid ablation conditions')
  const conditionHashes = Object.fromEntries(VARIANTS.map((variant) => [variant, memoryConditionDigest(input.conditions[variant], hashText)]))
  const { base, selected } = input.conditions
  ensure(canonical(base.experiment_context) === canonical(selected.experiment_context), 'Ablation experiment context must match')
  ensure(base.configuration_sha256 === selected.configuration_sha256, 'Ablation configuration must match')
  ensure(![...base.required_memories, ...selected.required_memories].some((ref) => ref.id === input.target.id), 'Ablation target must be optional')
  ensure(canonical(base.required_memories) === canonical(selected.required_memories), 'Required memory protection must match')
  ensure(!base.optional_memories.some((ref) => ref.id === input.target.id), 'Baseline must exclude the optional target')
  const target = selected.optional_memories.find((ref) => ref.id === input.target.id)
  ensure(target?.sha256 === input.target.sha256, 'Selected condition must include the optional target hash')
  ensure(canonical(base.optional_memories) === canonical(selected.optional_memories.filter((ref) => ref.id !== input.target.id)), 'Remaining optional memories must match in order')
  ensure(hash(input.plan_sha256) && memoryAblationPlanDigest(input.plan, hashText) === input.plan_sha256, 'Ablation plan hash mismatch')
  ensure(VARIANTS.every((variant) => input.plan.condition_sha256[variant] === conditionHashes[variant]), 'Planned condition hash mismatch')
  const comparison = compareRuns(input.comparison)
  const issues = [...comparison.eligibility.issues]
  const cases = new Map(input.plan.cases.map((entry) => [entry.case_id, entry.identity]))
  const observed = new Map(input.plan.cases.map((entry) => [entry.case_id, new Set()]))
  for (const run of input.comparison.runs) {
    ensure(cases.has(run.case_id), 'Run case is outside the fixed ablation plan')
    ensure(run.harness_sha256 === conditionHashes[run.variant], 'Run condition hash mismatch')
    ensure(run.attempts.length <= input.plan.max_attempts, 'Run exceeds planned attempt limit')
    observed.get(run.case_id).add(run.variant)
    for (const field of IDENTITY_FIELDS) {
      if (run.identity[field] !== cases.get(run.case_id)[field]) issues.push({ code: 'planned_identity_mismatch', case_id: run.case_id, variant: run.variant, field })
    }
    if (run.attempts.length < input.plan.max_attempts && run.attempts.at(-1).outcome !== 'pass') {
      issues.push({ code: 'incomplete_trial', case_id: run.case_id, variant: run.variant, remaining_attempts: input.plan.max_attempts - run.attempts.length })
    }
  }
  for (const [caseId, variants] of observed) {
    for (const variant of VARIANTS) if (!variants.has(variant)) issues.push({ code: 'planned_run_missing', case_id: caseId, variant })
  }
  object(input.experiment_costs, COMPONENTS, 'Invalid experiment costs')
  const components = COMPONENTS.map((name) => {
    usage(input.experiment_costs[name])
    return input.experiment_costs[name]
  })
  const overhead = totals(components)
  const incompleteTrials = issues.filter((issue) => issue.code === 'incomplete_trial').length
  const executionCoverage = {
    planned_runs: input.plan.cases.length * VARIANTS.length,
    reported_runs: input.comparison.runs.length,
    incomplete_trials: incompleteTrials,
    complete: incompleteTrials === 0 && !issues.some((issue) => issue.code === 'planned_run_missing'),
  }
  const recordedTotals = totals([comparison.variants.base.totals, comparison.variants.selected.totals, overhead])
  const eligibility = { comparable: issues.length === 0, issues }
  const observations = input.plan.cases.map(({ case_id: caseId }) => {
    const pair = input.comparison.runs.filter((run) => run.case_id === caseId)
    const baseline = pair.find((run) => run.variant === 'base')?.attempts.at(-1).outcome
    const candidate = pair.find((run) => run.variant === 'selected')?.attempts.at(-1).outcome
    let label = 'unknown'
    if (eligibility.comparable && baseline !== 'unknown' && candidate !== 'unknown') {
      if (baseline === candidate) label = 'unchanged'
      else if (baseline === 'pass') label = 'regression'
      else if (candidate === 'pass') label = 'improvement'
    }
    return { case_id: caseId, reported_outcome: label }
  })
  return {
    schema_version: 1,
    target: { ...input.target },
    experiment_context: { ...base.experiment_context },
    plan_sha256: input.plan_sha256,
    condition_sha256: conditionHashes,
    eligibility,
    comparison,
    observations,
    descriptive: eligibility.comparable ? comparison.descriptive : null,
    costs: {
      components: Object.fromEntries(COMPONENTS.map((name) => [name, { ...input.experiment_costs[name] }])),
      overhead_totals: overhead,
      overhead_coverage: Object.fromEntries(USAGE_FIELDS.map((field) => [field, { reported: components.filter((entry) => entry[field] !== null).length, components: components.length }])),
      execution_coverage: executionCoverage,
      recorded_totals: recordedTotals,
      experiment_totals: executionCoverage.complete ? { ...recordedTotals } : Object.fromEntries(Object.keys(recordedTotals).map((field) => [field, null])),
    },
    limitations: [
      ...comparison.limitations,
      'Memory selections, plan pins, observations and costs are self-reported; hashes bind records but do not authenticate execution or prior registration.',
      'The declared organization and scope identify this experiment, not authorization, database identity or currentness checks.',
      'Condition hashes fingerprint the common configuration and memory treatment, not repository code; configuration_sha256 must cover all other harness settings.',
      'This evaluates one optional memory in the pinned selection; observations are not causal proof and do not authorize promotion or removal.',
      'Outcome labels describe reported pass transitions only; they do not rank memory popularity, aggregate utility or token savings.',
      'Incomplete trials remain ineligible; their stop cause and any unreported usage are unknown.',
      'Construction, verification and maintenance costs are experiment overhead counted once, separate from run usage; no variant allocation or break-even is inferred.',
      'Recorded totals cover reported attempts and overhead only; missing planned executions or incomplete trials make all experiment totals unknown.',
      'Top-level eligibility includes the fixed plan; the nested comparison retains the original v1 record comparison only.',
    ],
  }
}
