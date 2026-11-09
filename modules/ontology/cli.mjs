import { parseArgs } from 'node:util'
import { inspectOntology, loadOntology, searchOntology } from './application.mjs'
import { ontologyFiles } from './files.mjs'
import { scrub } from '../../lib/scrub.mjs'

const usage = `Ariadne ontology inspect --file ontology.json
Ariadne ontology search --file ontology.json --query text [--limit 5]
Read-only local vocabulary lookup. No model, SQL execution or factual answerability claim.`

try {
  const [command, ...args] = process.argv.slice(2)
  if (!command || ['--help', '-h'].includes(command)) console.log(usage)
  else {
    if (!['inspect', 'search'].includes(command)) throw new Error(usage)
    const options = { file: { type: 'string' } }
    if (command === 'search') Object.assign(options, { query: { type: 'string' }, limit: { type: 'string' } })
    const { values, tokens } = parseArgs({ args, options, tokens: true, allowPositionals: false })
    const names = tokens.map((token) => token.name)
    if (new Set(names).size !== names.length) throw new Error('Duplicate ontology option')
    if (!values.file?.trim() || (command === 'search' && !values.query?.trim())) throw new Error(usage)
    if (values.limit !== undefined && !/^(?:[1-9]|1[0-9]|20)$/.test(values.limit)) throw new Error('limit must be an integer from 1 to 20')
    const snapshot = loadOntology(ontologyFiles(values.file))
    const result = command === 'inspect' ? inspectOntology(snapshot) : searchOntology(snapshot, values.query, values.limit === undefined ? 5 : Number(values.limit))
    console.log(JSON.stringify(result, (_key, value) => typeof value === 'string' ? scrub(value).text : value, 2))
  }
} catch (error) {
  console.error(`Ariadne ontology: ${scrub(error.message).text}`)
  process.exitCode = 2
}
