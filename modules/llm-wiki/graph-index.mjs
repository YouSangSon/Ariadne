import { indexWiki } from './application.mjs'
import { wikiFiles } from './files.mjs'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  if (i === -1 || !process.argv[i + 1]) {
    console.error(`graph-index: ${name} 필요`)
    process.exit(1)
  }
  return process.argv[i + 1]
}
const vault = arg('--vault')
const project = arg('--project')

try {
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const { entities, relations, unresolved } = indexWiki(wikiFiles({ vault, project }), project, today)
  console.log(`graph-index: entities=${entities} relations=${relations} unresolved=${unresolved}`)
} catch (error) {
  console.error(`graph-index: ${error.message}`)
  process.exit(1)
}
