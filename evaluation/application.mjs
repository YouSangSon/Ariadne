import { validateSuite, verifyFailures } from './domain.mjs'

export function verifyEvaluation(store) {
  const raw = store.readSuite()
  const digest = store.hash(raw)
  const expected = store.readExpectedHash().trim().split(/\s+/)[0]
  if (!/^[a-f0-9]{64}$/.test(expected) || digest !== expected) throw new Error('suite hash mismatch')
  const suite = JSON.parse(raw)
  validateSuite(suite)
  const workspace = store.createWorkspace()
  const tasks = []
  try {
    for (const task of suite.tasks) {
      const failures = store.measure(task, 'baseline', workspace, task.files)
      verifyFailures(failures, task.baseline_failures, `${task.id}: unexpected baseline failures`)
      const referenceFailures = store.measure(task, 'reference', workspace, { ...task.files, ...task.reference })
      verifyFailures(referenceFailures, [], `${task.id}: reference mismatch`)
      tasks.push({ id: task.id, baseline_failures: failures, reference_passed: task.checks.length })
    }
  } finally { store.removeWorkspace(workspace) }
  return { status: 'verified_fixture_controls', p8_quality: 'not_measured', suite_sha256: digest, tasks }
}

export async function probeTask(task, { loadFunction, equal }) {
  const run = await loadFunction(task.entry, task.export)
  const checks = []
  for (const check of task.checks) {
    const actual = await run(...check.args)
    checks.push({ id: check.id, passed: equal(actual, check.expected) })
  }
  return { task_id: task.id, checks }
}
