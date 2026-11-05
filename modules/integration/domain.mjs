import { computeCaps } from '../../lib/caps.mjs'

export const MIRROR_DIRS = ['.claude', '.agents']
export const CORE_LINE_CAP = 150
export const VERSION = '0.1.0'
export const BLOCK_BEGIN = `<!-- harness:begin v${VERSION} -->`
export const BLOCK_END = '<!-- harness:end -->'
export const BLOCK_RE = /\n?<!-- harness:begin[\s\S]*?<!-- harness:end -->\n?/
export const INSTALL_AREAS = ['core', 'skills', 'templates']
export const INSTALL_RUNTIME_FILES = [
  'lib/context-pack.mjs', 'lib/budget.mjs', 'lib/scrub.mjs',
  'modules/context/domain.mjs', 'modules/context/application.mjs', 'modules/context/files.mjs',
  'core/domain/requirement-fields.mjs',
]
const SRC_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'py', 'go', 'rs', 'java'])
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.harness)(\/|$)/

export function capSource(path) {
  return !SKIP_DIRS.test(path) && SRC_EXTS.has(path.split('.').at(-1))
}

export function renderMirrorSource(source, relative, hash) {
  const frontmatter = source.match(/^---\n[\s\S]*?\n---/)
  if (!frontmatter) throw new Error(`${relative}: YAML frontmatter가 없다 (1행이 --- 여야 함)`)
  return `${frontmatter[0]}\n\n<!-- generated: mirror of ${relative} | sha256:${hash} — 직접 수정 금지 -->${source.slice(frontmatter[0].length)}`
}

function adaptBody(lineCounts, verifyCommand) {
  const caps = computeCaps(lineCounts)
  return [
    '# Ariadne',
    '',
    '- 코어 규칙: `~/.harness/core/AGENTS.core.md` (요지: 모든 커밋에 `REQ: <slug>` 참조,',
    '  evidence 없는 done 금지, 시크릿은 `.env`에만, wrapper 직접 수정 금지)',
    `- 프로젝트 검증: \`${verifyCommand}\``,
    `- 파일 캡: 기존 파일 ${caps.existingCap}줄 / 신규 ${caps.newFileCap}줄`,
    '- REQ: `.harness/reqs/` — 모호한 요구는 구현 전 req-capture로',
  ].join('\n')
}

export function markedText(current, body) {
  const block = [BLOCK_BEGIN, body, BLOCK_END].join('\n')
  if (current === null) return { content: block + '\n', backup: false, state: 'created' }
  const marked = BLOCK_RE.test(current)
  const content = marked
    ? current.replace(BLOCK_RE, (match) => (match.startsWith('\n') ? '\n' : '') + block + '\n')
    : current.trimEnd() + '\n\n' + block + '\n'
  return { content, backup: !marked, state: content === current ? 'skipped' : 'updated' }
}

export function planAdapt({ agents, claude, manifest, lineCounts, verifyCommand }) {
  const nextManifest = { ...manifest, created: [...manifest.created], modified: [...manifest.modified] }
  const plans = [{ path: 'AGENTS.md', ...markedText(agents, adaptBody(lineCounts, verifyCommand)) }]
  const content = claude === null ? '@AGENTS.md\n' : claude.split('\n')[0] === '@AGENTS.md' ? claude : '@AGENTS.md\n\n' + claude
  plans.push({ path: 'CLAUDE.md', content, backup: claude !== null && content !== claude, state: claude === null ? 'created' : content === claude ? 'skipped' : 'updated' })
  for (const plan of plans) {
    if (plan.state === 'created' && !nextManifest.created.includes(plan.path)) nextManifest.created.push(plan.path)
    if (plan.backup && !nextManifest.modified.includes(plan.path)) nextManifest.modified.push(plan.path)
    else plan.backup = false
  }
  return { plans, manifest: nextManifest, ...countPlans(plans) }
}

export function countPlans(plans) {
  const result = { created: 0, updated: 0, skipped: 0 }
  for (const { state } of plans) result[state]++
  return result
}

export function planInstallFile({ path, content, present, identical }) {
  return { path, content, state: !present ? 'created' : identical ? 'skipped' : 'updated' }
}

export function planGlobalPointer(target, previous, core) {
  const plan = markedText(target.current, target.kind === 'claude' ? `@${core.path}` : core.content.trim())
  const backup = `backup/${target.id}.bak`
  return {
    ...plan, path: target.path,
    backupPath: plan.backup ? backup : null,
    record: plan.state === 'created'
      ? { path: target.path, backup: null }
      : plan.backup ? { path: target.path, backup }
        : previous ?? { path: target.path, backup: target.backupExists ? backup : null },
  }
}

export function mirrorErrors(core, mirrors) {
  const errors = []
  if (core === null) errors.push('core/AGENTS.core.md 없음')
  else {
    const lines = core.split('\n').length
    if (lines > CORE_LINE_CAP) errors.push(`core/AGENTS.core.md: ${lines}줄 — 캡 ${CORE_LINE_CAP} 초과`)
  }
  for (const { path, actual, expected, error } of mirrors) {
    if (error) { errors.push(error); continue }
    if (actual === null) { errors.push(`${path}: 미러 없음 — generate-mirrors 실행 필요`); continue }
    if (!actual.startsWith('---\n')) errors.push(`${path}: 1행이 --- 가 아님 (P1 실측 로드 실패 조건)`)
    if (actual !== expected) errors.push(`${path}: SSOT와 드리프트 — generate-mirrors로 재생성`)
  }
  return errors
}
