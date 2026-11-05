function ensure(condition, message) { if (!condition) throw new Error(message) }

const ID = /^[a-z0-9][a-z0-9-]*$/
const own = (value, key) => Object.hasOwn(value, key)

export function validateSuite(suite) {
  ensure(suite.schema_version === 1, 'suite schema_version must be 1')
  ensure(typeof suite.suite_id === 'string' && ID.test(suite.suite_id), 'invalid suite ID')
  ensure(Array.isArray(suite.tasks) && suite.tasks.length >= 3 && suite.tasks.length <= 5, 'three to five controls required')
  ensure(new Set(suite.tasks.map((task) => task.id)).size === suite.tasks.length, 'duplicate task IDs')
  for (const task of suite.tasks) {
    ensure(typeof task.id === 'string' && ID.test(task.id), 'invalid task ID')
    ensure(typeof task.prompt === 'string' && task.prompt.trim(), 'task prompt required')
    for (const files of [task.files, task.reference]) {
      ensure(files && typeof files === 'object' && !Array.isArray(files) && Object.keys(files).length, 'file map required')
      for (const [path, text] of Object.entries(files)) {
        ensure(path.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\:\x00-\x1f]/.test(part)), 'unsafe file path')
        ensure(typeof text === 'string', 'file content must be a string')
      }
    }
    ensure(typeof task.entry === 'string' && task.entry.endsWith('.mjs') && own(task.files, task.entry), 'entry must be a fixture module path')
    ensure(Object.keys(task.reference).every((path) => own(task.files, path)), 'reference must modify existing files')
    ensure(typeof task.export === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(task.export), 'function export required')
    ensure(Array.isArray(task.checks) && task.checks.length, 'checks required')
    ensure(new Set(task.checks.map((check) => check.id)).size === task.checks.length, 'duplicate check IDs')
    for (const check of task.checks) {
      ensure(typeof check.id === 'string' && ID.test(check.id), 'invalid check ID')
      ensure(Array.isArray(check.args) && own(check, 'expected'), 'JSON args and expected result required')
    }
    ensure(Array.isArray(task.baseline_failures) && task.baseline_failures.length, 'baseline failures required')
    ensure(new Set(task.baseline_failures).size === task.baseline_failures.length, 'duplicate baseline failures')
    ensure(task.baseline_failures.every((id) => task.checks.some((check) => check.id === id)), 'unknown baseline failures')
  }
}

export function verifyFailures(actual, expected, message) {
  ensure(actual.length === expected.length && actual.every((id, index) => id === expected[index]), message)
}
