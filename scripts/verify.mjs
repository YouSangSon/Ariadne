// 로컬 결정론 게이트 (§4.6) — 밀폐: 글로벌 설치본 없이 성립. 실패 시 즉사(fail-fast)
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRootFromArgs } from './mirror-lib.mjs'
import { scrub } from '../lib/scrub.mjs'

const root = repoRootFromArgs(process.argv)
const scriptsDir = dirname(fileURLToPath(import.meta.url))
const REQ_LINE = /^REQ: ([a-z0-9][a-z0-9-]*|none \(.+\))$/m

function step(name, fn) {
  process.stdout.write(`verify: ${name} … `)
  const err = fn()
  if (err) {
    console.log('FAIL')
    console.error(`verify: ${name}: ${err}`)
    process.exit(1)
  }
  console.log('ok')
}

function run(command, args) {
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  if (!r.error && !r.signal && r.status === 0) return null
  const reason = r.error ? `spawn error ${r.error.code ?? 'unknown'}: ${r.error.message}` : r.signal ? `signal ${r.signal}` : `exit ${r.status}`
  return scrub((r.error ? [reason] : [reason, r.stdout, r.stderr]).filter(Boolean).join('\n')).text
}

step('tests', () => {
  return run(process.execPath, ['--test'])
})

step('check-mirror', () => {
  return run(process.execPath, [join(scriptsDir, 'check-mirror.mjs'), '--root', root])
})

step('commit-req-invariant', () => {
  const r = spawnSync('git', ['log', '--format=%H%n%B%x00', '-n', '20'], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) return 'git log 실패 (git 리포 아님?)'
  const bad = r.stdout
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((msg) => !REQ_LINE.test(msg))
  return bad.length === 0 ? null : `REQ 참조 없는 커밋 ${bad.length}개: ${bad.map((b) => b.slice(0, 7)).join(', ')}`
})

console.log('verify: green')
