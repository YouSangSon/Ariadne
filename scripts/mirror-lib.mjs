import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MIRROR_DIRS = ['.claude', '.agents']
export const CORE_LINE_CAP = 150
export const VERSION = '0.1.0'

// 마커 안만 하네스 소유 — adapt(프로젝트)·install --global-pointer(글로벌)가 공유
export const BLOCK_BEGIN = `<!-- harness:begin v${VERSION} -->`
export const BLOCK_END = '<!-- harness:end -->'
export const BLOCK_RE = /\n?<!-- harness:begin[\s\S]*?<!-- harness:end -->\n?/

export function repoRootFromArgs(argv) {
  const i = argv.indexOf('--root')
  if (i !== -1 && argv[i + 1]) return argv[i + 1]
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

export function listSkills(root) {
  const dir = join(root, 'skills')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md')))
    .map((e) => e.name)
}

// P1 실측 규칙: 산출물 1행은 반드시 "---" — 마커는 frontmatter 뒤에만
export function renderMirror(root, name) {
  const rel = `skills/${name}/SKILL.md`
  const src = readFileSync(join(root, rel), 'utf8')
  const fm = src.match(/^---\n[\s\S]*?\n---/)
  if (!fm) throw new Error(`${rel}: YAML frontmatter가 없다 (1행이 --- 여야 함)`)
  const hash = createHash('sha256').update(src).digest('hex').slice(0, 12)
  const body = src.slice(fm[0].length)
  return `${fm[0]}\n\n<!-- generated: mirror of ${rel} | sha256:${hash} — 직접 수정 금지 -->${body}`
}
