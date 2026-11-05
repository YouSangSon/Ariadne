import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readlinkSync, readSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 1024 * 1024
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

export function requirementFiles(root) {
  return {
    readRequirement(reqId) {
      const input = localInput(realpathSync(root), `.harness/reqs/${reqId}.yaml`)
      if (input.kind !== 'file') throw new Error('REQ must be a regular file, not a missing file or symlink')
      try { return new TextDecoder('utf-8', { fatal: true }).decode(input.content).replaceAll('\r\n', '\n') }
      catch { throw new Error('REQ must be UTF-8 text') }
    },
    hash: (value) => createHash('sha256').update(value).digest('hex'),
  }
}

export function sourceFilesAdapter(root) {
  const directory = realpathSync(root)
  return {
    inspectGit() {
      const git = (...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', directory, ...args], { encoding: 'utf8', maxBuffer: 4 * MAX_BYTES, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
      let head
      let paths
      try {
        if (realpathSync(git('rev-parse', '--show-toplevel').trim()) !== directory) throw new Error('Project root must be the Git repository root')
        paths = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
        try { head = git('rev-parse', '--verify', '--quiet', 'HEAD').trim() }
        catch (error) { if (error.status === 1) head = null; else throw error }
      } catch { throw new Error('Git repository inspection failed') }
      return { head, paths }
    },
    readInput: (path) => localInput(directory, path),
    sourceHasher() {
      const hash = createHash('sha256')
      return { update: (value) => hash.update(value), digest: () => hash.digest('hex') }
    },
  }
}
