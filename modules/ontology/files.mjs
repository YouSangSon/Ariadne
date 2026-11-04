import { createHash } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { readProjectText } from '../../lib/project-files.mjs'

export function ontologyFiles(file) {
  const absolute = resolve(file)
  const root = dirname(absolute)
  let identity
  return {
    readDocument() {
      const source = readProjectText(root, basename(absolute))
      identity = source.identity
      try { return JSON.parse(source.content) }
      catch { throw new Error('Invalid ontology JSON') }
    },
    readSource(path) {
      const source = readProjectText(root, path)
      if (source.identity.dev === identity.dev && source.identity.ino === identity.ino) throw new Error('Ontology manifest cannot be its own source')
      return source.sha256
    },
    hash: (text) => createHash('sha256').update(text).digest('hex'),
  }
}
