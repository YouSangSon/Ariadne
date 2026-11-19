import { randomUUID } from 'node:crypto'
import { closeSync, constants, openSync, readSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const changed = () => new Error('Source input changed during read')
const tooLarge = () => new Error('Source input size exceeds 64 MiB')

// A regular virtual file can report zero or a nominal size unrelated to its readable bytes.
function hasReportedEnd(fd, size) {
  if (!Number.isSafeInteger(size) || size < 1) return false
  const byte = Buffer.allocUnsafe(1)
  try {
    return readSync(fd, byte, 0, 1, size - 1) === 1 && readSync(fd, byte, 0, 1, size) === 0
  } catch (error) {
    if (['ESPIPE', 'EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) return false
    throw error
  }
}

function streamKnownLength(fd, length, first, scratch, consume) {
  consume(scratch.subarray(0, first))
  let used = first
  for (;;) {
    const n = readSync(fd, scratch, 0, Math.min(scratch.length, length - used + 1), null)
    if (n === 0) break
    used += n
    if (used > length) throw changed()
    consume(scratch.subarray(0, n))
  }
  if (used !== length) throw changed()
}

// The wire header precedes the content and includes its actual length. Stage only
// an input that exceeds the scratch buffer and cannot supply a reliable length.
function visitUnmeasured(fd, first, scratch, remaining, visit) {
  const name = join(tmpdir(), 'ariadne-source-' + randomUUID())
  const spool = openSync(name, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600)
  let linked = true
  try {
    unlinkSync(name)
    linked = false
    let size = 0
    for (let n = first; n > 0; n = readSync(fd, scratch, 0, Math.min(scratch.length, remaining - size + 1), null)) {
      size += n
      if (size > remaining) throw tooLarge()
      let offset = 0
      while (offset < n) {
        const written = writeSync(spool, scratch, offset, n - offset)
        if (!written) throw new Error('Could not stage source input')
        offset += written
      }
    }
    visit(size, (consume) => {
      let offset = 0
      while (offset < size) {
        const n = readSync(spool, scratch, 0, Math.min(scratch.length, size - offset), offset)
        if (!n) throw changed()
        consume(scratch.subarray(0, n))
        offset += n
      }
    })
  } finally {
    try { closeSync(spool) }
    finally { if (linked) unlinkSync(name) }
  }
}

export function visitRegularFile(fd, size, remaining, scratch, visit) {
  const limit = Math.min(scratch.length, remaining + 1)
  let first = 0
  while (first < limit) {
    const n = readSync(fd, scratch, first, limit - first, null)
    if (!n) break
    first += n
  }
  if (first > remaining) throw tooLarge()
  if (first < limit) {
    visit(first, (consume) => consume(scratch.subarray(0, first)))
  } else if (size >= first && hasReportedEnd(fd, size)) {
    visit(size, (consume) => streamKnownLength(fd, size, first, scratch, consume))
  } else {
    visitUnmeasured(fd, first, scratch, remaining, visit)
  }
}
