import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import { VERSION, repoRootFromArgs, BLOCK_BEGIN, BLOCK_END, BLOCK_RE } from './mirror-lib.mjs'

// D3: 기본 설치 대상은 독립 prefix뿐 — 글로벌(~/.claude, ~/.codex)은
// --global-pointer를 명시한 opt-in에서만, 마커 블록 + 백업으로만 만진다
const INSTALL_AREAS = ['core', 'skills', 'templates']

const root = repoRootFromArgs(process.argv)
const pi = process.argv.indexOf('--prefix')
const prefix = pi !== -1 && process.argv[pi + 1] ? process.argv[pi + 1] : join(homedir(), '.harness')

function sourceFiles() {
  const files = []
  for (const area of INSTALL_AREAS) {
    const base = join(root, area)
    if (!existsSync(base)) continue
    for (const e of readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (!e.isFile()) continue
      const abs = join(e.parentPath, e.name)
      files.push(relative(root, abs).split(sep).join('/'))
    }
  }
  return files.sort()
}

try {
  let created = 0
  let updated = 0
  let skipped = 0
  const files = sourceFiles()
  for (const rel of files) {
    const src = readFileSync(join(root, rel))
    const dest = join(prefix, rel)
    if (existsSync(dest)) {
      if (readFileSync(dest).equals(src)) {
        skipped += 1
        continue
      }
      writeFileSync(dest, src)
      updated += 1
      continue
    }
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, src)
    created += 1
  }
  mkdirSync(prefix, { recursive: true })

  // opt-in 글로벌 포인터 (§5, §2.3): Claude는 @import 1줄, Codex는 코어 규칙 사본
  const globalPointer = []
  if (process.argv.includes('--global-pointer')) {
    // 재실행 시 최초 설치의 created/backup 기록을 승계 — 아니면 uninstall 복원이 틀어진다
    const prevPath = join(prefix, 'manifest.json')
    const prev = new Map(
      (existsSync(prevPath) ? (JSON.parse(readFileSync(prevPath, 'utf8')).globalPointer ?? []) : []).map(
        (e) => [e.path, e],
      ),
    )
    const corePath = join(prefix, 'core', 'AGENTS.core.md')
    const targets = [
      { id: 'claude-CLAUDE.md', path: join(homedir(), '.claude', 'CLAUDE.md'), body: `@${corePath}` },
      { id: 'codex-AGENTS.md', path: join(homedir(), '.codex', 'AGENTS.md'), body: readFileSync(corePath, 'utf8').trim() },
    ]
    for (const t of targets) {
      const block = [BLOCK_BEGIN, t.body, BLOCK_END].join('\n')
      if (!existsSync(t.path)) {
        mkdirSync(dirname(t.path), { recursive: true })
        writeFileSync(t.path, block + '\n')
        globalPointer.push({ path: t.path, backup: null })
        created += 1
        continue
      }
      const cur = readFileSync(t.path, 'utf8')
      if (BLOCK_RE.test(cur)) {
        const next = cur.replace(BLOCK_RE, (m) => (m.startsWith('\n') ? '\n' : '') + block + '\n')
        if (next === cur) skipped += 1
        else {
          writeFileSync(t.path, next)
          updated += 1
        }
        globalPointer.push(
          prev.get(t.path) ?? {
            path: t.path,
            backup: existsSync(join(prefix, 'backup', `${t.id}.bak`)) ? `backup/${t.id}.bak` : null,
          },
        )
      } else {
        mkdirSync(join(prefix, 'backup'), { recursive: true })
        copyFileSync(t.path, join(prefix, 'backup', `${t.id}.bak`))
        writeFileSync(t.path, cur.trimEnd() + '\n\n' + block + '\n')
        globalPointer.push({ path: t.path, backup: `backup/${t.id}.bak` })
        updated += 1
      }
    }
  }

  writeFileSync(
    join(prefix, 'manifest.json'),
    JSON.stringify({ version: VERSION, files, globalPointer }, null, 2) + '\n',
  )
  console.log(`install: prefix=${prefix} created=${created} updated=${updated} skipped=${skipped}`)
} catch (err) {
  console.error(`install: ${err.message}`)
  process.exit(1)
}
