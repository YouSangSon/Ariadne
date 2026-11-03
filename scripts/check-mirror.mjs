import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { MIRROR_DIRS, CORE_LINE_CAP, listSkills, renderMirror, repoRootFromArgs } from './mirror-lib.mjs'

const root = repoRootFromArgs(process.argv)
const errors = []

const corePath = join(root, 'core', 'AGENTS.core.md')
if (existsSync(corePath)) {
  const lines = readFileSync(corePath, 'utf8').split('\n').length
  if (lines > CORE_LINE_CAP) errors.push(`core/AGENTS.core.md: ${lines}줄 — 캡 ${CORE_LINE_CAP} 초과`)
} else {
  errors.push('core/AGENTS.core.md 없음')
}

for (const name of listSkills(root)) {
  let expected
  try {
    expected = renderMirror(root, name)
  } catch (err) {
    errors.push(err.message)
    continue
  }
  for (const dir of MIRROR_DIRS) {
    const rel = `${dir}/skills/${name}/SKILL.md`
    const dest = join(root, rel)
    if (!existsSync(dest)) {
      errors.push(`${rel}: 미러 없음 — generate-mirrors 실행 필요`)
      continue
    }
    const actual = readFileSync(dest, 'utf8')
    if (!actual.startsWith('---\n')) errors.push(`${rel}: 1행이 --- 가 아님 (P1 실측 로드 실패 조건)`)
    if (actual !== expected) errors.push(`${rel}: SSOT와 드리프트 — generate-mirrors로 재생성`)
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`check-mirror: ${e}`)
  process.exit(1)
}
console.log('check-mirror: ok')
