import { commitErrors, sourceTests } from '../domain/verification.mjs'

export function verifySources(modules, ports) {
  const steps = [
    [modules.has('code') ? 'source tests + code integration' : 'source tests only', () => {
      let tests
      try { tests = sourceTests(ports.listTests(), modules) }
      catch (error) { return error.message }
      return ports.runTests(tests)
    }],
    ['check-mirror', () => ports.checkMirrors()],
    ['commit-req-invariant', () => {
      const log = ports.commitLog()
      return log === null ? 'git log 실패 (git 리포 아님?)' : commitErrors(log)
    }],
  ]
  for (const [name, run] of steps) {
    ports.start(name)
    const error = run()
    ports.finish(name, error)
    if (error) return 1
  }
  ports.report('verify: green')
  return 0
}
