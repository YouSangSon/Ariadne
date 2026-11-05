// SessionStart 훅 — 버전 핀 대조 advisory (§4.7). 항상 exit 0
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { rootFromArgs, audit } from './hook-io.mjs'
import { VERSION } from '../modules/integration/domain.mjs'

const root = rootFromArgs(process.argv)
const manifest = join(homedir(), '.harness', 'manifest.json')

let decision = 'pass'
if (existsSync(manifest)) {
  try {
    const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
    if (installed !== VERSION) {
      decision = 'advisory'
      console.error(`session-start(advisory): 설치본 ${installed} ≠ 리포 ${VERSION} — harness install 재실행 권장`)
    }
  } catch {
    decision = 'advisory'
  }
}
audit(root, 'session-start', decision)
process.exit(0)
