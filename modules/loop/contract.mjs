import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readlinkSync, readSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fieldBlock } from '../../lib/context-pack.mjs'

const MAX_BYTES = 1024 * 1024
const STATUSES = new Set(['needs_intake', 'needs_clarification', 'ready_for_routing', 'verified'])
const SCOPE_FIELDS = [
  'requirement.user_intent', 'requirement.desired_outcome', 'requirement.confirmed_facts', 'requirement.assumptions',
  'code_mapping.boundary_rules', 'audit.must_not_implement',
  'verification.commands', 'verification.verify_gate_required', 'verification.verify_gate_reason', 'verification.escalate_after',
]
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function slug(reqId) {
  if (typeof reqId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(reqId)) throw new Error('REQ slug must use lowercase letters, digits, and hyphens')
  return reqId
}

function localInput(root, path) {
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..') || path.includes('\\')) throw new Error('Unsafe Git input path')
  for (let i = 0; i < parts.length; i++) {
    let stat
    try { stat = lstatSync(join(root, ...parts.slice(0, i + 1))) }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { kind: 'missing', mode: null, content: Buffer.alloc(0) }
      throw error
    }
    if (stat.isSymbolicLink()) {
      if (i !== parts.length - 1) throw new Error('Symbolic link ancestor is not allowed')
      return { kind: 'symlink', mode: stat.mode & 0o777, content: Buffer.from(readlinkSync(join(root, path))) }
    }
    if (i !== parts.length - 1) {
      if (!stat.isDirectory()) return { kind: 'missing', mode: null, content: Buffer.alloc(0) }
      continue
    }
    if (!stat.isFile()) throw new Error('Source input must be a regular file or symbolic link')
  }
  const fd = openSync(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('Source input must be a regular file')
    if (stat.size > MAX_BYTES) throw new Error('File size exceeds 1 MiB')
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    let size = 0
    let count
    while ((count = readSync(fd, buffer, size, buffer.length - size, null)) > 0) {
      size += count
      if (size > MAX_BYTES) throw new Error('File size exceeds 1 MiB')
    }
    return { kind: 'file', mode: stat.mode & 0o777, content: buffer.subarray(0, size) }
  } finally { closeSync(fd) }
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

export function loadContract(root, reqId) {
  slug(reqId)
  const input = localInput(realpathSync(root), `.harness/reqs/${reqId}.yaml`)
  if (input.kind !== 'file') throw new Error('REQ must be a regular file, not a missing file or symlink')
  let yaml
  try { yaml = new TextDecoder('utf-8', { fatal: true }).decode(input.content).replaceAll('\r\n', '\n') }
  catch { throw new Error('REQ must be UTF-8 text') }
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
  return { req_id: reqId, status, criteria, hash: sha256(JSON.stringify({ req_id: reqId, criteria, scope })) }
}

export function sourceState(root, { reqId } = {}) {
  const directory = realpathSync(root)
  if (reqId !== undefined) slug(reqId)
  const git = (...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', directory, ...args], { encoding: 'utf8', maxBuffer: 4 * MAX_BYTES, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
  let head
  let paths
  try {
    if (realpathSync(git('rev-parse', '--show-toplevel').trim()) !== directory) throw new Error('Project root must be the Git repository root')
    paths = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
    try { head = git('rev-parse', '--verify', '--quiet', 'HEAD').trim() }
    catch (error) { if (error.status === 1) head = null; else throw error }
  } catch { throw new Error('Git repository inspection failed') }
  const selected = reqId === undefined ? null : `.harness/reqs/${reqId}.yaml`
  const files = [...new Set(paths)].filter((path) => path !== selected && !path.split('/').some((part) => ['.git', 'node_modules'].includes(part)) && path !== '.harness/handoff' && !path.startsWith('.harness/handoff/')).sort()
  if (files.length > 10000) throw new Error('Source input file count exceeds 10000')
  const hash = createHash('sha256')
  let total = 0
  for (const path of files) {
    const { kind, mode, content } = localInput(directory, path)
    total += content.length
    if (total > 64 * MAX_BYTES) throw new Error('Source input size exceeds 64 MiB')
    hash.update(JSON.stringify([path, kind, mode, content.length]) + '\n')
    hash.update(content)
  }
  return { hash: hash.digest('hex'), head, files }
}
