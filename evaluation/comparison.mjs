const HASH = /^[a-f0-9]{64}$/
const IDENTITY_FIELDS = ['input_sha256', 'verifier_sha256', 'model', 'effort', 'environment_sha256']
const USAGE_FIELDS = ['input_tokens', 'output_tokens', 'cost_usd']
const OUTCOMES = ['pass', 'fail', 'error', 'unknown']

function ensure(condition, message) { if (!condition) throw new Error(message) }
function object(value, fields, message) {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), message)
  ensure(Object.keys(value).every((field) => fields.includes(field)), message)
}
function id(value) {
  return typeof value === 'string' && value.length <= 128 && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value)
}
function hash(value) { return typeof value === 'string' && HASH.test(value) }

function validate(input) {
  object(input, ['schema_version', 'baseline', 'candidate', 'runs'], 'Invalid comparison object')
  ensure(input.schema_version === 1 && input.baseline === 'base' && input.candidate === 'selected', 'Invalid comparison version or variants')
  ensure(Array.isArray(input.runs) && input.runs.length <= 1000, 'Invalid run count')
  const pairs = new Map()
  for (const run of input.runs) {
    object(run, ['case_id', 'variant', 'identity', 'harness_sha256', 'attempts'], 'Invalid run')
    ensure(id(run.case_id) && ['base', 'selected'].includes(run.variant), 'Invalid case ID or variant')
    object(run.identity, IDENTITY_FIELDS, 'Invalid identity')
    for (const field of IDENTITY_FIELDS) {
      const value = run.identity[field]
      ensure(value == null || (field.endsWith('_sha256') ? hash(value) : id(value)), 'Invalid identity field')
    }
    ensure(hash(run.harness_sha256), 'Invalid harness hash')
    ensure(Array.isArray(run.attempts) && run.attempts.length > 0 && run.attempts.length <= 100, 'Invalid attempt count')
    for (const [index, attempt] of run.attempts.entries()) {
      object(attempt, ['outcome', ...USAGE_FIELDS, 'evidence_sha256'], 'Invalid attempt')
      ensure(OUTCOMES.includes(attempt.outcome), 'Invalid outcome')
      ensure(attempt.outcome !== 'pass' || index === run.attempts.length - 1, 'A reported pass cannot be retried')
      ensure(attempt.evidence_sha256 == null || hash(attempt.evidence_sha256), 'Invalid evidence hash')
      ensure(attempt.outcome !== 'pass' || hash(attempt.evidence_sha256), 'A reported pass requires a verifier receipt')
      for (const field of USAGE_FIELDS) {
        const value = attempt[field]
        ensure(value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && (field === 'cost_usd' || Number.isSafeInteger(value))), 'Invalid usage')
      }
    }
    if (!pairs.has(run.case_id)) pairs.set(run.case_id, {})
    const pair = pairs.get(run.case_id)
    ensure(!Object.hasOwn(pair, run.variant), 'Duplicate case and variant')
    pair[run.variant] = run
  }
  return pairs
}

function summarize(runs) {
  const counts = { pass: 0, fail: 0, error: 0, unknown: 0 }
  const sums = { input_tokens: 0, output_tokens: 0, cost_usd: 0 }
  const coverage = Object.fromEntries(USAGE_FIELDS.map((field) => [field, { reported: 0, attempts: 0 }]))
  let attempts = 0
  for (const run of runs) {
    counts[run.attempts.at(-1).outcome]++
    for (const attempt of run.attempts) {
      attempts++
      for (const field of USAGE_FIELDS) {
        coverage[field].attempts++
        if (attempt[field] != null) {
          coverage[field].reported++
          sums[field] += attempt[field]
          ensure(Number.isFinite(sums[field]) && (field === 'cost_usd' || Number.isSafeInteger(sums[field])), 'Usage total exceeds numeric limits')
        }
      }
    }
  }
  const total = (field) => coverage[field].reported === attempts ? sums[field] : null
  const input = total('input_tokens')
  const output = total('output_tokens')
  const cost = total('cost_usd')
  const tokens = input === null || output === null ? null : input + output
  ensure(tokens === null || Number.isSafeInteger(tokens), 'Usage total exceeds numeric limits')
  return {
    attempted_cases: runs.length, attempts,
    reported_passes: counts.pass, reported_failures: counts.fail,
    reported_errors: counts.error, reported_unknowns: counts.unknown,
    totals: { input_tokens: input, output_tokens: output, total_tokens: tokens, cost_usd: cost, cost_per_reported_pass_usd: cost === null || !counts.pass ? null : cost / counts.pass },
    coverage,
  }
}

export function compareRuns(input) {
  const pairs = validate(input)
  const issues = []
  const runs = { base: [], selected: [] }
  const regressions = []
  let pairedCases = 0
  if (!pairs.size) issues.push({ code: 'no_cases' })
  for (const [caseId, pair] of [...pairs].sort(([left], [right]) => left.localeCompare(right))) {
    for (const variant of ['base', 'selected']) if (pair[variant]) runs[variant].push(pair[variant])
    if (!pair.base || !pair.selected) {
      issues.push({ code: 'missing_pair', case_id: caseId })
      continue
    }
    pairedCases++
    const issueCount = issues.length
    for (const field of IDENTITY_FIELDS) {
      const baseline = pair.base.identity[field]
      const candidate = pair.selected.identity[field]
      if (baseline == null || candidate == null) issues.push({ code: 'identity_missing', case_id: caseId, field })
      else if (baseline !== candidate) issues.push({ code: 'identity_mismatch', case_id: caseId, field })
    }
    const baseline = pair.base.attempts.at(-1).outcome
    const candidate = pair.selected.attempts.at(-1).outcome
    if (issues.length === issueCount && baseline === 'pass' && candidate !== 'pass') regressions.push({ case_id: caseId, baseline_outcome: baseline, candidate_outcome: candidate })
  }
  const harnesses = {}
  for (const variant of ['base', 'selected']) {
    harnesses[variant] = new Set(runs[variant].map((run) => run.harness_sha256))
    if (harnesses[variant].size > 1) issues.push({ code: 'inconsistent_harness', variant })
  }
  if (harnesses.base.size === 1 && harnesses.selected.size === 1 && [...harnesses.base][0] === [...harnesses.selected][0]) issues.push({ code: 'same_harness' })
  const variants = { base: summarize(runs.base), selected: summarize(runs.selected) }
  const delta = (field) => {
    const baseline = variants.base.totals[field]
    const candidate = variants.selected.totals[field]
    return baseline === null || candidate === null ? null : candidate - baseline
  }
  return {
    schema_version: 1,
    eligibility: { comparable: issues.length === 0, issues },
    variants,
    paired: { paired_cases: pairedCases, reported_regressions: regressions },
    descriptive: issues.length ? null : {
      reported_passes_delta: variants.selected.reported_passes - variants.base.reported_passes,
      total_tokens_delta: delta('total_tokens'), cost_usd_delta: delta('cost_usd'),
    },
    limitations: [
      'Outcomes and verifier receipts are reported by the input and are not independently authenticated.',
      'Differences and paired outcomes are descriptive, not causal or statistical proof.',
      'Cost calculations use floating-point numbers and may contain rounding error.',
    ],
  }
}
