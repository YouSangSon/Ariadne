import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import { readProjectText } from '../core/infrastructure/project-files.mjs'
import { scrub } from '../lib/scrub.mjs'
import { evaluateMemoryAblation } from './memory-ablation.mjs'

try {
  const { values, tokens } = parseArgs({
    options: { file: { type: 'string' }, root: { type: 'string' } },
    tokens: true, allowPositionals: false,
  })
  const names = tokens.map((token) => token.name)
  if (new Set(names).size !== names.length || !values.file?.trim() || (values.root !== undefined && !values.root.trim())) {
    throw new Error('Usage: Ariadne eval memory-ablation --file relative/path [--root directory]')
  }
  const source = readProjectText(values.root ?? process.cwd(), values.file)
  let input
  try { input = JSON.parse(source.content) }
  catch { throw new Error('Invalid memory ablation JSON') }
  const hashText = (text) => createHash('sha256').update(text).digest('hex')
  const report = { source: { path: source.path, sha256: source.sha256 }, ...evaluateMemoryAblation(input, hashText) }
  console.log(JSON.stringify(report, (_key, value) => typeof value === 'string' ? scrub(value).text : value, 2))
} catch (error) {
  console.error(`Ariadne eval memory-ablation: ${scrub(error.message).text}`)
  process.exitCode = 2
}
