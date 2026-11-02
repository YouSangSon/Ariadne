// llm-wiki 옵션 모듈 — .harness 기록을 볼트 sources 페이지로 승격 (REQ llm-wiki-ontology)
// 단일 진실은 볼트가 아니라 .harness가 아님에 주의: 이 페이지는 "그날의 스냅샷" 승격본이다.
// 규약: filename == H1 == 위키링크 (aliases 미사용 볼트)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { scrub } from '../../lib/scrub.mjs'

const arg = (name, req = false) => {
  const i = process.argv.indexOf(name)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  if (req) {
    console.error(`promote: ${name} 필요`)
    process.exit(1)
  }
  return undefined
}

const root = arg('--root') ?? process.cwd()
const vault = arg('--vault', true)
const project = arg('--project', true)
const date = arg('--date') ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

const readIf = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)

try {
  const h = join(root, '.harness')
  const decisions = lines(readIf(join(h, 'decisions.md')))
  const handoff = lines(readIf(join(h, 'handoff', 'LATEST.md')))
  const reqsDir = join(h, 'reqs')
  const verifiedReqs = existsSync(reqsDir)
    ? readdirSync(reqsDir)
        .filter((f) => f.endsWith('.yaml'))
        .sort()
        .map((f) => readIf(join(reqsDir, f)))
        .filter((t) => t.includes('status: verified'))
        .map((t) => `${t.match(/req_id:\s*(\S+)/)?.[1]} — ${t.match(/title:\s*(.+)/)?.[1] ?? ''}`)
    : []

  const title = `${date} ${project} harness sync`
  const body = [
    '---',
    'metadata:',
    '  type: source',
    `  project: ${project}`,
    '  status: active',
    `  updated: ${date}`,
    `tags: [${project}, harness-sync]`,
    '---',
    '',
    `# ${title}`,
    '',
    `harness \`.harness/\` 기록의 ${date} 승격 스냅샷. 원본이 진실이며 이 페이지는 파생이다.`,
    '',
    '## Decisions',
    decisions.map((d) => `- ${d.replace(/^-\s*/, '')}`).join('\n') || '- (없음)',
    '',
    '## Verified REQs',
    verifiedReqs.map((r) => `- ${r}`).join('\n') || '- (없음)',
    '',
    '## Handoff',
    handoff.map((l) => `- ${l}`).join('\n') || '- (없음)',
    '',
  ].join('\n')

  const { text } = scrub(body)
  const dir = join(vault, 'Projects', project, 'Long', 'llm-wiki', 'wiki', 'sources')
  mkdirSync(dir, { recursive: true })
  const page = join(dir, `${title}.md`)

  if (existsSync(page) && readFileSync(page, 'utf8') === text) {
    console.log(`promote: changed=0 page=${page}`)
  } else {
    writeFileSync(page, text)
    const log = join(vault, 'Projects', project, 'Long', 'llm-wiki', 'log.md')
    const logLine = `- ${date}: harness sync — decisions ${decisions.length}, verified REQ ${verifiedReqs.length} → [[${title}]]\n`
    if (!readIf(log).includes(logLine.trim())) appendFileSync(log, logLine)
    console.log(`promote: changed=1 page=${page}`)
  }
} catch (err) {
  console.error(`promote: ${err.message}`)
  process.exit(1)
}
