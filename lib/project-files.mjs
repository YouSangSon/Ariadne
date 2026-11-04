import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { detect, scrub } from './scrub.mjs'

const MAX_BYTES = 1024 * 1024
const BLOCKED = new Set(['.git', '.harness', '.codex', '.claude', '.gemini', '.agents', 'node_modules', '.ssh', '.aws', '.gnupg', '.netrc', '.npmrc', '.pypirc', '.mcp.json', 'agents.md', 'claude.md', 'gemini.md'])
const sha256 = (content) => createHash('sha256').update(content).digest('hex')

function projectPath(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path) || /^[A-Za-z]:/.test(path)) throw new Error('Project path is denied')
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Project path must be a contained relative path')
  if (parts.some((part) => {
    const name = part.toLowerCase()
    return BLOCKED.has(name) || name.startsWith('.env') || /(?:^|[._-])(?:credentials?|secrets?)(?:$|[._-])/.test(name) || /^(?:id_(?:rsa|dsa|ecdsa|ed25519))(?:\.|$)/.test(name) || /\.(?:pem|p12|pfx|key)$/.test(name)
  })) throw new Error('Protected project path is denied')
  return parts
}

function inspect(root, parts) {
  for (let i = 0; i < parts.length; i++) {
    let stat
    try { stat = lstatSync(join(root, ...parts.slice(0, i + 1))) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are denied')
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('Project path ancestor must be a directory')
    if (i === parts.length - 1) return stat
  }
}

function readBytes(root, parts) {
  const stat = inspect(root, parts)
  if (!stat) return null
  if (!stat.isFile()) throw new Error('Project path must be a regular file')
  const fd = openSync(join(root, ...parts), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile()) throw new Error('Project path must be a regular file')
    if (opened.size > MAX_BYTES) throw new Error('File size exceeds 1 MiB')
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    let size = 0
    let count
    while ((count = readSync(fd, buffer, size, buffer.length - size, null)) > 0) {
      size += count
      if (size > MAX_BYTES) throw new Error('File size exceeds 1 MiB')
    }
    return { bytes: buffer.subarray(0, size), mode: opened.mode & 0o777, identity: { dev: opened.dev, ino: opened.ino } }
  } finally { closeSync(fd) }
}

function text(bytes) {
  let content
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new Error('Project files must contain UTF-8 text') }
  if (content.includes('\0')) throw new Error('Binary project files are denied')
  return content
}

// Internal adapters only: callers must scrub raw text before presenting it.
export function readProjectText(root, path) {
  const parts = projectPath(path)
  const file = readBytes(realpathSync(root), parts)
  if (!file) throw new Error('Project file does not exist')
  return { path, content: text(file.bytes), sha256: sha256(file.bytes), identity: file.identity }
}

export function readProjectFile(root, path) {
  const file = readProjectText(root, path)
  return { path, content: scrub(file.content).text, sha256: file.sha256 }
}

export function listProjectFiles(root) {
  const directory = realpathSync(root)
  const files = []
  let entries = 0
  const walk = (relative = '') => {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
      if (++entries > 10000) throw new Error('Project entry count exceeds 10000')
      if (entry.isSymbolicLink()) continue
      const path = relative ? `${relative}/${entry.name}` : entry.name
      try { projectPath(path) } catch { continue }
      const stat = inspect(directory, path.split('/'))
      if (stat?.isDirectory()) walk(path)
      else if (stat?.isFile()) files.push(path)
    }
  }
  walk()
  return files.sort()
}

export function writeProjectFile(root, path, content, expectedSha) {
  const parts = projectPath(path)
  if (typeof content !== 'string') throw new Error('Project content must be a string')
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('File size exceeds 1 MiB')
  const bytes = Buffer.from(content)
  if (text(bytes) !== content) throw new Error('Project content must be valid UTF-8 text')
  const categories = detect(content)
  if (categories.length) throw new Error(`Secret content is denied (${categories.join(', ')})`)
  if (expectedSha !== null && (typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha))) throw new Error('expectedSha must be a SHA-256 hash or null')
  const directory = realpathSync(root)
  const original = readBytes(directory, parts)
  const check = (file) => {
    if ((file ? sha256(file.bytes) : null) !== expectedSha) throw new Error('Project file SHA mismatch; file changed')
  }
  check(original)
  const target = join(directory, ...parts)
  const created = []
  let temporary
  let fd
  try {
    for (let i = 1; i < parts.length; i++) {
      const parent = join(directory, ...parts.slice(0, i))
      if (!inspect(directory, parts.slice(0, i))) {
        mkdirSync(parent)
        created.push(parent)
      }
    }
    temporary = join(dirname(target), `.ariadne-write-${randomUUID()}.tmp`)
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, original?.mode ?? 0o666)
    writeFileSync(fd, bytes)
    if (original) fchmodSync(fd, original.mode)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    check(readBytes(directory, parts))
    // shortcut: the final check and rename need an exclusive host workspace; use OS isolation for arbitrary external writers.
    renameSync(temporary, target)
    temporary = undefined
    return { path, sha256: sha256(bytes) }
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (temporary) {
      try { unlinkSync(temporary) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    for (const parent of created.reverse()) {
      try { rmdirSync(parent) }
      catch (error) { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error }
    }
  }
}
