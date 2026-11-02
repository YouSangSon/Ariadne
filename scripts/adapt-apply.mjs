// adapt 3단계(생성)의 결정론 부분 (§4.8) — 감지·판단은 스킬이, 파일 정확성은 여기가 담당
// 마커 안만 하네스 소유. 마커 밖은 절대 불가침 (리뷰 3-1)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { computeCaps } from '../lib/caps.mjs'
import { VERSION, BLOCK_BEGIN as BEGIN, BLOCK_END as END, BLOCK_RE } from './mirror-lib.mjs'
const SRC_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.java'])
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.harness)(\/|$)/

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : undefined
}
const target = arg('--target') ?? process.cwd()
const verifyCmd = arg('--verify-cmd') ?? '(미확정 — adapt 스킬이 사용자에게 확인)'

function scanCaps() {
  const counts = []
  for (const e of readdirSync(target, { recursive: true, withFileTypes: true })) {
    const rel = join(e.parentPath, e.name).slice(target.length + 1)
    if (!e.isFile() || SKIP_DIRS.test(rel) || !SRC_EXTS.has(extname(e.name))) continue
    counts.push(readFileSync(join(target, rel), 'utf8').split('\n').length)
  }
  return computeCaps(counts)
}

function renderBlock() {
  const caps = scanCaps()
  return [
    BEGIN,
    '# Ariadne',
    '',
    '- 코어 규칙: `~/.harness/core/AGENTS.core.md` (요지: 모든 커밋에 `REQ: <slug>` 참조,',
    '  evidence 없는 done 금지, 시크릿은 `.env`에만, wrapper 직접 수정 금지)',
    `- 프로젝트 검증: \`${verifyCmd}\``,
    `- 파일 캡: 기존 파일 ${caps.existingCap}줄 / 신규 ${caps.newFileCap}줄`,
    '- REQ: `.harness/reqs/` — 모호한 요구는 구현 전 req-capture로',
    END,
  ].join('\n')
}

// manifest: created는 remove 시 삭제, modified는 백업에서 복원
const manifestPath = join(target, '.harness', 'adapt-manifest.json')
const backupDir = join(target, '.harness', 'backup')
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { version: VERSION, created: [], modified: [] }

let created = 0
let updated = 0
let skipped = 0

function backupOnce(rel) {
  if (manifest.modified.includes(rel)) return
  mkdirSync(backupDir, { recursive: true })
  copyFileSync(join(target, rel), join(backupDir, `${rel}.bak`))
  manifest.modified.push(rel)
}

function writeChanged(rel, next) {
  const p = join(target, rel)
  if (readFileSync(p, 'utf8') === next) {
    skipped += 1
    return
  }
  writeFileSync(p, next)
  updated += 1
}

try {
  const block = renderBlock()

  const agentsPath = join(target, 'AGENTS.md')
  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, block + '\n')
    manifest.created.includes('AGENTS.md') || manifest.created.push('AGENTS.md')
    created += 1
  } else {
    const cur = readFileSync(agentsPath, 'utf8')
    if (BLOCK_RE.test(cur))
      writeChanged('AGENTS.md', cur.replace(BLOCK_RE, (m) => (m.startsWith('\n') ? '\n' : '') + block + '\n'))
    else {
      backupOnce('AGENTS.md')
      writeChanged('AGENTS.md', cur.trimEnd() + '\n\n' + block + '\n')
    }
  }

  const claudePath = join(target, 'CLAUDE.md')
  if (!existsSync(claudePath)) {
    writeFileSync(claudePath, '@AGENTS.md\n')
    manifest.created.includes('CLAUDE.md') || manifest.created.push('CLAUDE.md')
    created += 1
  } else if (readFileSync(claudePath, 'utf8').split('\n')[0] !== '@AGENTS.md') {
    backupOnce('CLAUDE.md')
    writeChanged('CLAUDE.md', '@AGENTS.md\n\n' + readFileSync(claudePath, 'utf8'))
  } else skipped += 1

  mkdirSync(join(target, '.harness'), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`adapt-apply: target=${target} created=${created} updated=${updated} skipped=${skipped}`)
} catch (err) {
  console.error(`adapt-apply: ${err.message}`)
  process.exit(1)
}
