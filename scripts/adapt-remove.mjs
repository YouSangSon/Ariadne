// adapt 언인스톨 — manifest 기반 제거 + 백업 복원 (§4.8). 사용자 파일은 건드리지 않는다
import { readFileSync, rmSync, rmdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const i = process.argv.indexOf('--target')
const target = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : process.cwd()
const manifestPath = join(target, '.harness', 'adapt-manifest.json')
const backupDir = join(target, '.harness', 'backup')

if (!existsSync(manifestPath)) {
  console.error(`adapt-remove: ${manifestPath} 없음 — adapt 적용본이 아니다`)
  process.exit(1)
}

try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const rel of manifest.created) existsSync(join(target, rel)) && rmSync(join(target, rel))
  for (const rel of manifest.modified) {
    const bak = join(backupDir, `${rel}.bak`)
    if (existsSync(bak)) copyFileSync(bak, join(target, rel))
  }
  existsSync(backupDir) && rmSync(backupDir, { recursive: true })
  rmSync(manifestPath)
  // .harness는 비어 있을 때만 제거 — 사용자 REQ 등은 보존
  const h = join(target, '.harness')
  if (existsSync(h) && readdirSync(h).length === 0) rmdirSync(h)
  console.log(`adapt-remove: target=${target} restored=${manifest.modified.length} removed=${manifest.created.length}`)
} catch (err) {
  console.error(`adapt-remove: ${err.message}`)
  process.exit(1)
}
