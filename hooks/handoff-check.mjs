// Stop 훅 — advisory 전용, 항상 exit 0 (fail-open 명시 §4.7)
// stop_hook_active 체크는 의무(§0.2 — Stop 훅 무한루프 #55754)
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readStdinJson, rootFromArgs, audit } from './hook-io.mjs'

const root = rootFromArgs(process.argv)
const input = readStdinJson()

if (input?.stop_hook_active) {
  audit(root, 'handoff-check', 'skip', 'stop_hook_active')
  process.exit(0)
}

const latest = join(root, '.harness', 'handoff', 'LATEST.md')
const today = new Date().toDateString()
const fresh = existsSync(latest) && statSync(latest).mtime.toDateString() === today

audit(root, 'handoff-check', fresh ? 'pass' : 'advisory')
if (!fresh) console.error('handoff-check(advisory): 오늘 handoff 기록이 없다 — 미커밋 상태가 있으면 /handoff 권장')
process.exit(0)
