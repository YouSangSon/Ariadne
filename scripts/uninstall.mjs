import { readFileSync, writeFileSync, rmSync, rmdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const pi = process.argv.indexOf('--prefix')
const prefix = pi !== -1 && process.argv[pi + 1] ? process.argv[pi + 1] : join(homedir(), '.harness')
const manifestPath = join(prefix, 'manifest.json')

if (!existsSync(manifestPath)) {
  console.error(`uninstall: ${manifestPath} — manifest.json이 없다. 설치본이 아니거나 이미 제거됨`)
  process.exit(1)
}

function pruneEmptyDirs(dir) {
  if (dir === prefix || !existsSync(dir)) return
  if (readdirSync(dir).length === 0) {
    rmdirSync(dir)
    pruneEmptyDirs(dirname(dir))
  }
}

try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  let removed = 0

  // 글로벌 포인터 복원 (install --global-pointer의 역): backup 있으면 원상, 없으면 우리가 만든 파일이므로 삭제
  for (const e of manifest.globalPointer ?? []) {
    if (e.backup) {
      writeFileSync(e.path, readFileSync(join(prefix, e.backup)))
      rmSync(join(prefix, e.backup))
    } else if (existsSync(e.path)) {
      rmSync(e.path)
      if (existsSync(dirname(e.path)) && readdirSync(dirname(e.path)).length === 0) rmdirSync(dirname(e.path))
    }
    removed += 1
  }
  if (existsSync(join(prefix, 'backup')) && readdirSync(join(prefix, 'backup')).length === 0)
    rmdirSync(join(prefix, 'backup'))
  for (const rel of manifest.files) {
    const p = join(prefix, rel)
    if (existsSync(p)) {
      rmSync(p)
      removed += 1
    }
    pruneEmptyDirs(dirname(p))
  }
  rmSync(manifestPath)
  console.log(`uninstall: prefix=${prefix} removed=${removed}`)
} catch (err) {
  console.error(`uninstall: ${err.message}`)
  process.exit(1)
}
