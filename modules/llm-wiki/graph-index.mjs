// 온톨로지 인덱스 — 볼트 위키링크에서 파생 생성 (REQ llm-wiki-ontology AC2)
// 매 실행 전체 재생성한다. 이후 볼트가 바뀌면 다음 실행까지 인덱스가 오래될 수 있다.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  if (i === -1 || !process.argv[i + 1]) {
    console.error(`graph-index: ${name} 필요`)
    process.exit(1)
  }
  return process.argv[i + 1]
}
const vault = arg('--vault')
const project = arg('--project')

const mdFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))

const stripCode = (s) => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')

try {
  const projWiki = join(vault, 'Projects', project, 'Long', 'llm-wiki')
  const indexName = `${project} Ontology Index`
  // 해석은 Obsidian처럼 볼트 전역 basename 기준
  const vaultNames = new Set(mdFiles(vault).map((p) => basename(p, '.md')))

  const edges = []
  const unresolved = new Set()
  for (const p of mdFiles(projWiki)) {
    const from = basename(p, '.md')
    if (from === indexName) continue
    for (const m of stripCode(readFileSync(p, 'utf8')).matchAll(/\[\[([^\]|#\n]+?)(?:\\?\|[^\]]*)?\]\]/g)) {
      const to = m[1].trim()
      if (vaultNames.has(to)) edges.push(`${from} → ${to}`)
      else unresolved.add(`${to} (← ${from})`)
    }
  }

  const outCount = {}
  for (const e of edges) {
    const from = e.split(' → ')[0]
    outCount[from] = (outCount[from] ?? 0) + 1
  }

  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const text = [
    '---',
    'metadata:',
    '  type: graph',
    `  project: ${project}`,
    '  status: active',
    `  updated: ${today}`,
    `tags: [${project}, ontology, derived]`,
    '---',
    '',
    `# ${indexName}`,
    '',
    '**파생 문서** — 이 위키의 위키링크에서 전체 재생성된다. 손으로 고치지 말 것 (재실행이 덮어쓴다).',
    '',
    '## Entities (outbound 링크 수)',
    Object.entries(outCount).sort().map(([n, c]) => `- [[${n}]] (${c})`).join('\n') || '- (없음)',
    '',
    '## Relations',
    [...new Set(edges)].sort().map((e) => `- ${e}`).join('\n') || '- (없음)',
    '',
    '## Unresolved links',
    [...unresolved].sort().map((u) => `- ${u}`).join('\n') || '- (없음)',
    '',
  ].join('\n')

  const dir = join(projWiki, 'wiki', 'graphs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${indexName}.md`), text)
  console.log(`graph-index: entities=${Object.keys(outCount).length} relations=${new Set(edges).size} unresolved=${unresolved.size}`)
} catch (err) {
  console.error(`graph-index: ${err.message}`)
  process.exit(1)
}
