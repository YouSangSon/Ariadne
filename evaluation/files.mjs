import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { probeTask } from './application.mjs'
export async function probe(root) {
  try {
    const task = JSON.parse(readFileSync(0, 'utf8'))
    const result = await probeTask(task, {
      async loadFunction(entry, name) {
        const module = await import(pathToFileURL(join(root, entry)).href)
        assert.equal(typeof module[name], 'function')
        return (...args) => module[name](...args)
      },
      equal: isDeepStrictEqual,
    })
    process.stdout.write(JSON.stringify(result))
  } catch {
    process.exitCode = 2
  }
}

function measure(task, phase, root, probePath, files) {
  mkdirSync(root, { recursive: true })
  for (const [path, text] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  const r = spawnSync(process.execPath, [probePath, '--probe', root], {
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

export function evaluationFiles(root, probePath) {
  return {
    readSuite: () => readFileSync(join(root, 'evaluation/suite.json')),
    readExpectedHash: () => readFileSync(join(root, 'evaluation/suite.sha256'), 'utf8'),
    hash: (raw) => createHash('sha256').update(raw).digest('hex'),
    createWorkspace: () => mkdtempSync(join(tmpdir(), 'ariadne-controls-')),
    measure: (task, phase, workspace, files) => measure(task, phase, join(workspace, task.id, phase), probePath, files),
    removeWorkspace: (workspace) => rmSync(workspace, { recursive: true, force: true }),
  }
}
