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
    const { kind, mode, content } = store.readInput(path)
    total += content.length
    if (total > 64 * 1024 * 1024) throw new Error('Source input size exceeds 64 MiB')
    hash.update(JSON.stringify([path, kind, mode, content.length]) + '\n')
    hash.update(content)
  }
  return { hash: hash.digest(), head, files }
}
