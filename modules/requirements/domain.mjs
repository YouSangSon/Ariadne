import { fieldBlock } from '../../core/domain/requirement-fields.mjs'

const STATUSES = new Set(['needs_intake', 'needs_clarification', 'ready_for_routing', 'verified'])
const SCOPE_FIELDS = [
  'requirement.user_intent', 'requirement.desired_outcome', 'requirement.confirmed_facts', 'requirement.assumptions',
  'code_mapping.boundary_rules', 'audit.must_not_implement',
  'verification.commands', 'verification.verify_gate_required', 'verification.verify_gate_reason', 'verification.escalate_after',
]

export function slug(reqId) {
  if (typeof reqId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(reqId)) throw new Error('REQ slug must use lowercase letters, digits, and hyphens')
  return reqId
}

function scalar(head, continuation = [], indent = 8) {
  const value = head.trim()
  if (/^[|>]/.test(value)) {
    const marker = value.match(/^([|>])(-?)(?:\s+#.*)?$/)
    if (!marker) throw new Error('REQ unsupported multiline scalar')
    const lines = continuation.map((line) => {
      if (!line.trim()) return ''
      if (line.search(/\S/) < indent) throw new Error('REQ multiline scalar indentation is unsupported')
      return line.slice(indent)
    })
    while (lines.at(-1) === '') lines.pop()
    let text = lines.join('\n')
    if (marker[1] === '>') {
      text = lines.map((line, i) => {
        const next = lines[i + 1]
        const separator = next === undefined ? '' : line.startsWith(' ') || next.startsWith(' ') || line === '' ? '\n' : next === '' ? '' : ' '
        return line + separator
      }).join('')
    }
    return text + (marker[2] || !lines.length ? '' : '\n')
  }
  if (continuation.some((line) => line.trim() && !line.trimStart().startsWith('#'))) throw new Error('REQ unsupported scalar continuation')
  if (value.startsWith("'")) {
    const match = value.match(/^'((?:[^']|'')*)'(?:\s+#.*)?$/)
    if (!match) throw new Error('REQ unsupported quoted scalar')
    return match[1].replaceAll("''", "'")
  }
  if (value.startsWith('"')) {
    const match = value.match(/^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/)
    if (!match) throw new Error('REQ unsupported quoted scalar')
    try { return JSON.parse(match[1]) }
    catch { throw new Error('REQ unsupported quoted scalar escape') }
  }
  const plain = value.replace(/\s+#.*$/, '').trimEnd()
  if (!plain || /^(?:[-?:]\s|[!&*\[\]{}|>@`"'#])/.test(plain) || /:\s|:$/.test(plain) || /^(?:null|~|true|false|[-+]?(?:\d[\d_.]*|\.\d+)(?:e[-+]?\d+)?|[-+]?\.(?:inf|nan))$/i.test(plain)) {
    throw new Error('REQ unsupported or empty string scalar')
  }
  return plain
}

function criteriaFrom(block) {
  const lines = block.split('\n')
  if (!/^  acceptance_criteria:(?: +(?:#.*)?)?$/.test(lines.shift() ?? '')) throw new Error('REQ acceptance_criteria must be a canonical block list')
  const items = []
  for (const line of lines) {
    if (/^    - id:(?= |$)/.test(line)) items.push([line.replace(/^    - /, '      ')])
    else if (items.length) items.at(-1).push(line)
    else if (line.trim() && !line.trimStart().startsWith('#')) throw new Error('REQ unsupported acceptance_criteria item')
  }
  const ids = new Set()
  return items.map((lines) => {
    const fields = new Map()
    let current
    for (const line of lines) {
      const match = line.match(/^      ([a-z_][a-z0-9_]*):((?: .*)?)$/)
      if (match) {
        const [, key, head] = match
        if (!['id', 'priority', 'statement', 'verification', 'passes'].includes(key)) throw new Error('REQ unsupported AC field')
        if (fields.has(key)) throw new Error('REQ duplicate AC field')
        current = { head, lines: [] }
        fields.set(key, current)
      } else if (!line.trim() || (line.trimStart().startsWith('#') && line.search(/\S/) < 8)) {
        if (current && !line.trim()) current.lines.push(line)
      } else {
        if (!current || line.search(/\S/) < 8) throw new Error('REQ unsupported AC indentation or mapping')
        current.lines.push(line)
      }
    }
    const result = {}
    for (const key of ['id', 'statement', 'verification']) {
      const field = fields.get(key)
      if (!field) throw new Error(`REQ AC ${key} is required`)
      result[key] = scalar(field.head, field.lines)
      if (!result[key].trim()) throw new Error(`REQ AC ${key} must not be empty`)
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(result.id) || ids.has(result.id)) throw new Error('REQ invalid or duplicate AC ID')
    ids.add(result.id)
    const priority = fields.get('priority')
    if (priority && !['P0', 'P1', 'P2'].includes(scalar(priority.head, priority.lines))) throw new Error('REQ unsupported AC priority')
    const passes = fields.get('passes')
    if (passes && (passes.lines.some((line) => line.trim() && !line.trimStart().startsWith('#')) || !/^(?:null|true|false)\s*(?:#.*)?$/.test(passes.head.trim()))) throw new Error('REQ unsupported AC passes value')
    return result
  })
}

export function parseContract(yaml, reqId) {
  slug(reqId)
  if (yaml.includes('\0') || /^ *\t/m.test(yaml)) throw new Error('REQ unsupported control character or indentation')
  const top = new Set()
  for (const line of yaml.split('\n')) {
    if (!line.trim() || /^\s|^#/.test(line)) continue
    const key = line.match(/^([a-z_][a-z0-9_]*):(?= |$)/)?.[1]
    if (!key) throw new Error('REQ requires canonical plain mapping keys')
    if (top.has(key)) throw new Error('REQ duplicate top-level mapping')
    top.add(key)
  }
  const metadata = (key) => {
    const block = fieldBlock(yaml, ['metadata', key])
    const [line, ...continuation] = block.split('\n')
    if (!new RegExp(`^  ${key}:(?: |$)`).test(line ?? '')) throw new Error(`REQ metadata.${key} is required`)
    return scalar(line.slice(key.length + 3), continuation, 4)
  }
  if (metadata('req_id') !== reqId) throw new Error('REQ metadata.req_id must match the filename slug')
  const status = metadata('status')
  if (!STATUSES.has(status)) throw new Error('REQ metadata.status is unknown')
  const criteria = criteriaFrom(fieldBlock(yaml, ['functional_contract', 'acceptance_criteria']))
  if (!criteria.length) throw new Error('REQ acceptance_criteria must not be empty')
  const scope = SCOPE_FIELDS.map((path) => fieldBlock(yaml, path.split('.')))
  return { req_id: reqId, status, criteria, scope }
}

export function sourceFiles(paths, reqId) {
  const selected = reqId === undefined ? null : `.harness/reqs/${reqId}.yaml`
  const files = [...new Set(paths)].filter((path) => path !== selected && !path.split('/').some((part) => ['.git', 'node_modules'].includes(part)) && path !== '.harness/handoff' && !path.startsWith('.harness/handoff/')).sort()
  if (files.length > 10000) throw new Error('Source input file count exceeds 10000')
  return files
}
