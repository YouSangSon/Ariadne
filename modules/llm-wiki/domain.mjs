import { scrub } from '../../lib/scrub.mjs'

const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean)
const stripCode = (text) => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')

export function renderPromotion({ decisions: decisionText, handoff: handoffText, requirements }, project, date) {
  const decisions = lines(decisionText)
  const handoff = lines(handoffText)
  const verifiedReqs = requirements.filter((text) => text.includes('status: verified'))
    .map((text) => `${text.match(/req_id:\s*(\S+)/)?.[1]} — ${text.match(/title:\s*(.+)/)?.[1] ?? ''}`)
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

  return {
    title, text: scrub(body).text,
    logLine: `- ${date}: harness sync — decisions ${decisions.length}, verified REQ ${verifiedReqs.length} → [[${title}]]\n`,
  }
}

export function renderGraph({ names, pages }, project, today) {
  const indexName = `${project} Ontology Index`
  const vaultNames = new Set(names)
  const edges = []
  const unresolved = new Set()
  for (const { name: from, text: source } of pages) {
    if (from === indexName) continue
    for (const m of stripCode(source).matchAll(/\[\[([^\]|#\n]+?)(?:\\?\|[^\]]*)?\]\]/g)) {
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

  return { indexName, text, entities: Object.keys(outCount).length, relations: new Set(edges).size, unresolved: unresolved.size }
}
