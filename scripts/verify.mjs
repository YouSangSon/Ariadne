// 로컬 결정론 게이트 (§4.6) — 밀폐: 글로벌 설치본 없이 성립. 실패 시 즉사(fail-fast)
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRootFromArgs } from './mirror-lib.mjs'
import { selectModules } from '../lib/module-selection.mjs'
import { verifySources } from '../core/application/verification.mjs'
import { scrub } from '../lib/scrub.mjs'

const root = repoRootFromArgs(process.argv)
const args = process.argv.slice(2)
const rootIndex = args.indexOf('--root')
if (rootIndex !== -1 && args[rootIndex + 1] && !args[rootIndex + 1].startsWith('--')) args.splice(rootIndex, 2)
let modules
try { modules = selectModules(args, ['core', 'ontology']) }
catch (error) { console.error(`verify: ${error.message}`); process.exit(2) }
const scriptsDir = dirname(fileURLToPath(import.meta.url))

function run(command, args) {
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  if (!r.error && !r.signal && r.status === 0) return null
  const reason = r.error ? `spawn error ${r.error.code ?? 'unknown'}: ${r.error.message}` : r.signal ? `signal ${r.signal}` : `exit ${r.status}`
  return scrub((r.error ? [reason] : [reason, r.stdout, r.stderr]).filter(Boolean).join('\n')).text
}

process.exitCode = verifySources(modules, {
  listTests: () => readdirSync(join(root, 'tests')),
  runTests: (tests) => run(process.execPath, ['--test', ...tests.map((name) => join(root, 'tests', name))]),
  checkMirrors: () => run(process.execPath, [join(scriptsDir, 'check-mirror.mjs'), '--root', root]),
  commitLog() {
    const result = spawnSync('git', ['log', '--format=%H%n%B%x00', '-n', '20'], { cwd: root, encoding: 'utf8' })
    return result.status === 0 ? result.stdout : null
  },
  start: (name) => process.stdout.write(`verify: ${name} … `),
  finish(name, error) {
    console.log(error ? 'FAIL' : 'ok')
    if (error) console.error(`verify: ${name}: ${error}`)
  },
  report: (message) => console.log(message),
})
