import { parseContract, slug, sourceFiles } from './domain.mjs'

// The reader supplies strict UTF-8 text; the hasher preserves the canonical contract payload.
export function loadContract({ readRequirement, hash }, reqId) {
  slug(reqId)
  const { scope, ...contract } = parseContract(readRequirement(reqId), reqId)
  return { ...contract, hash: hash(JSON.stringify({ req_id: reqId, criteria: contract.criteria, scope })) }
}

export function sourceState(store, { reqId } = {}) {
  if (reqId !== undefined) slug(reqId)
  const { head, paths } = store.inspectGit()
  const files = sourceFiles(paths, reqId)
  const hash = store.sourceHasher()
  let total = 0
  for (const path of files) {
    const remaining = 64 * 1024 * 1024 - total
    const header = (kind, mode, length) => {
      if (length > remaining) throw new Error('Source input size exceeds 64 MiB')
      total += length
      hash.update(JSON.stringify([path, kind, mode, length]) + '\n')
    }
    if (!store.visitInput) {
      const { kind, mode, content } = store.readInput(path)
      header(kind, mode, content.length)
      hash.update(content)
      continue
    }
    let visited = false
    let failure
    // A port may catch a callback error. A rejected frame can never produce a digest.
    const checked = (callback) => (...args) => {
      if (failure) throw failure.error
      try { return callback(...args) }
      catch (error) { failure ??= { error }; throw failure.error }
    }
    store.visitInput(path, remaining, checked((kind, mode, length, write) => {
      if (visited || !Number.isSafeInteger(length) || length < 0) throw new Error('Invalid source input frame')
      visited = true
      header(kind, mode, length)
      let written = 0
      write(checked((chunk) => {
        if (!(chunk instanceof Uint8Array)) throw new Error('Source input must contain bytes')
        if (chunk.byteLength > length - written) throw new Error('Source input length mismatch')
        hash.update(chunk)
        written += chunk.byteLength
      }))
      if (failure) throw failure.error
      if (written !== length) throw new Error('Source input length mismatch')
    }))
    if (failure) throw failure.error
    if (!visited) throw new Error('Source input was not delivered')
  }
  return { hash: hash.digest(), head, files }
}
